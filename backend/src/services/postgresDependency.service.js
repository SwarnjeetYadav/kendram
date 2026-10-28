import { ApiError } from '../utils/apiError.js'
import { resolvePostgresProjectAccess } from './postgresTaskMapping.service.js'

async function resolveTask(client, taskId, userId, role) {
  const value = String(taskId ?? '')
  const result = await client.query(
    `SELECT t.id,t.legacy_mongo_id,t.title,t.priority,t.due_date,t.assignee_id,
            c.name AS column_name,b.project_id,p.legacy_mongo_id AS project_legacy_mongo_id,
            a.legacy_mongo_id AS assignee_legacy_mongo_id
       FROM tasks t
       JOIN boards b ON b.id=t.board_id
       JOIN projects p ON p.id=b.project_id
       JOIN board_columns c ON c.id=t.column_id
       LEFT JOIN users a ON a.id=t.assignee_id
       WHERE t.legacy_mongo_id=$1 OR t.id::text=$1
       LIMIT 1`,
    [value],
  )
  const task = result.rows[0]
  if (!task) throw new ApiError(404, 'Task not found in PostgreSQL')
  const access = await resolvePostgresProjectAccess(client, {
    projectId: task.project_legacy_mongo_id,
    userId,
    role,
  })
  const status = ({ 'To Do': 'TODO', 'In Progress': 'IN_PROGRESS', Review: 'REVIEW', Blocked: 'BLOCKED', Done: 'COMPLETED' })[task.column_name]
    || task.column_name.toUpperCase().replaceAll(' ', '_')
  return { task: { ...task, status }, access }
}

const id = (task) => task.legacy_mongo_id || task.id
function taskDto(task) {
  return {
    _id: id(task), id: task.id, title: task.title, status: task.status,
    priority: task.priority, assigneeId: task.assignee_legacy_mongo_id || null,
    dueDate: task.due_date,
  }
}

async function loadEdges(client, projectId) {
  const result = await client.query(
    `SELECT d.id,d.legacy_mongo_id,d.created_at,
            pre.id AS pre_id,pre.legacy_mongo_id AS pre_legacy_id,pre.title AS pre_title,
            pre.priority AS pre_priority,pre.due_date AS pre_due_date,pre_assignee.legacy_mongo_id AS pre_assignee_id,
            pre_col.name AS pre_column_name,
            suc.id AS suc_id,suc.legacy_mongo_id AS suc_legacy_id,suc.title AS suc_title,
            suc.priority AS suc_priority,suc.due_date AS suc_due_date,suc_assignee.legacy_mongo_id AS suc_assignee_id,
            suc_col.name AS suc_column_name
       FROM task_dependencies d
       JOIN tasks pre ON pre.id=d.predecessor_task_id
       JOIN board_columns pre_col ON pre_col.id=pre.column_id
       LEFT JOIN users pre_assignee ON pre_assignee.id=pre.assignee_id
       JOIN tasks suc ON suc.id=d.successor_task_id
       JOIN board_columns suc_col ON suc_col.id=suc.column_id
       LEFT JOIN users suc_assignee ON suc_assignee.id=suc.assignee_id
       WHERE d.project_id=$1 ORDER BY d.created_at,d.id`,
    [projectId],
  )
  return result.rows.map((r) => ({
    _id: r.legacy_mongo_id || r.id, id: r.id, createdAt: r.created_at,
    predecessorTaskId: taskDto({ id:r.pre_id,legacy_mongo_id:r.pre_legacy_id,title:r.pre_title,priority:r.pre_priority,due_date:r.pre_due_date,assignee_legacy_mongo_id:r.pre_assignee_id,column_name:r.pre_column_name,status:statusFor(r.pre_column_name) }),
    successorTaskId: taskDto({ id:r.suc_id,legacy_mongo_id:r.suc_legacy_id,title:r.suc_title,priority:r.suc_priority,due_date:r.suc_due_date,assignee_legacy_mongo_id:r.suc_assignee_id,column_name:r.suc_column_name,status:statusFor(r.suc_column_name) }),
  }))
}
function statusFor(name) {
  return ({ 'To Do':'TODO','In Progress':'IN_PROGRESS',Review:'REVIEW',Blocked:'BLOCKED',Done:'COMPLETED' })[name] || name.toUpperCase().replaceAll(' ','_')
}

export async function listPostgresDependencies({ pool, taskId, userId, role }) {
  const client = await pool.connect()
  try {
    const { task, access } = await resolveTask(client, taskId, userId, role)
    const edges = await loadEdges(client, access.project.id)
    return edges.filter((edge) => String(edge.predecessorTaskId.id) === String(task.id) || String(edge.successorTaskId.id) === String(task.id))
  } finally { client.release() }
}

export async function addPostgresDependency({ pool, taskId, predecessorTaskId, userId, role }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { task: successor, access } = await resolveTask(client, taskId, userId, role)
    const { task: predecessor } = await resolveTask(client, predecessorTaskId, userId, role)
    if (successor.id === predecessor.id) throw new ApiError(400, 'A task cannot depend on itself')
    if (successor.project_id !== predecessor.project_id) throw new ApiError(422, 'Both tasks must belong to the same project')
    const existing = await client.query(
      'SELECT id FROM task_dependencies WHERE project_id=$1 AND predecessor_task_id=$2 AND successor_task_id=$3',
      [access.project.id, predecessor.id, successor.id],
    )
    if (existing.rowCount) throw new ApiError(409, 'This dependency already exists')
    const all = await client.query('SELECT predecessor_task_id,successor_task_id FROM task_dependencies WHERE project_id=$1', [access.project.id])
    const graph = new Map()
    for (const edge of all.rows) {
      const from=String(edge.predecessor_task_id), to=String(edge.successor_task_id)
      if (!graph.has(from)) graph.set(from, [])
      graph.get(from).push(to)
    }
    const queue=[String(successor.id)], visited=new Set(queue)
    while(queue.length) {
      const current=queue.shift()
      if(current===String(predecessor.id)) throw new ApiError(422,'Dependency would create a circular task chain')
      for(const next of graph.get(current)||[]) if(!visited.has(next)){visited.add(next);queue.push(next)}
    }
    const inserted = await client.query(
      `INSERT INTO task_dependencies (project_id,predecessor_task_id,successor_task_id,created_by)
       VALUES ($1,$2,$3,$4) RETURNING id,legacy_mongo_id,created_at`,
      [access.project.id,predecessor.id,successor.id,access.user.id],
    )
    await client.query(
      `INSERT INTO activity_logs (user_id,action,entity_type,entity_id,metadata)
       VALUES ($1,'TASK_DEPENDENCY_ADDED','TASK',$2,$3::jsonb)`,
      [access.user.id,successor.id,JSON.stringify({predecessorTaskId:id(predecessor),successorTaskId:id(successor),blocking:predecessor.status!=='COMPLETED'})],
    )
    await client.query('COMMIT')
    return {
      _id: inserted.rows[0].legacy_mongo_id || inserted.rows[0].id,
      id: inserted.rows[0].id,
      createdAt: inserted.rows[0].created_at,
      predecessorTaskId: taskDto(predecessor),
      successorTaskId: taskDto(successor),
    }
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>{})
    throw error
  } finally { client.release() }
}

export async function removePostgresDependency({ pool, taskId, dependencyId, userId, role }) {
  const client=await pool.connect()
  try {
    await client.query('BEGIN')
    const { task, access }=await resolveTask(client,taskId,userId,role)
    const found=await client.query(
      `SELECT id,legacy_mongo_id,predecessor_task_id,successor_task_id FROM task_dependencies
       WHERE project_id=$1 AND (legacy_mongo_id=$2 OR id::text=$2)
       AND (predecessor_task_id=$3 OR successor_task_id=$3)`,
      [access.project.id,String(dependencyId),task.id],
    )
    if(!found.rows[0]) throw new ApiError(404,'Task dependency not found')
    await client.query('DELETE FROM task_dependencies WHERE id=$1',[found.rows[0].id])
    await client.query(
      `INSERT INTO activity_logs (user_id,action,entity_type,entity_id,metadata)
       VALUES ($1,'TASK_DEPENDENCY_REMOVED','TASK',$2,$3::jsonb)`,
      [access.user.id,task.id,JSON.stringify({predecessorTaskId:found.rows[0].predecessor_task_id,successorTaskId:found.rows[0].successor_task_id})],
    )
    await client.query('COMMIT')
    return { dependencyId: found.rows[0].legacy_mongo_id || found.rows[0].id }
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>{})
    throw error
  } finally { client.release() }
}

export async function listPostgresBlockers({ pool, taskId, userId, role }) {
  const client=await pool.connect()
  try {
    const { task, access }=await resolveTask(client,taskId,userId,role)
    const result=await client.query(
      `SELECT pre.id,pre.legacy_mongo_id,pre.title,pre.priority,pre.due_date,
              pre_assignee.legacy_mongo_id AS assignee_legacy_mongo_id,pre_col.name AS column_name
       FROM task_dependencies d JOIN tasks pre ON pre.id=d.predecessor_task_id
       JOIN board_columns pre_col ON pre_col.id=pre.column_id
       LEFT JOIN users pre_assignee ON pre_assignee.id=pre.assignee_id
       WHERE d.project_id=$1 AND d.successor_task_id=$2
       AND upper(replace(pre_col.name,' ','_')) NOT IN ('DONE','COMPLETED') ORDER BY d.created_at`,
      [access.project.id,task.id],
    )
    return result.rows.map(r=>taskDto({...r,status:statusFor(r.column_name)}))
  } finally { client.release() }
}
