import { ApiError } from '../utils/apiError.js'
import { resolvePostgresProjectAccess, resolvePostgresBoardColumn, validateLegacyMongoId } from './postgresTaskMapping.service.js'

const priorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
const statuses = ['TODO', 'IN_PROGRESS', 'REVIEW', 'BLOCKED', 'COMPLETED']

function formatTaskActivity(action) {
  const messages = {
    TASK_CREATED: 'created the task',
    TASK_UPDATED: 'updated the task',
    TASK_STATUS_CHANGED: 'changed the task status',
    TASK_PRIORITY_CHANGED: 'changed the task priority',
    TASK_ASSIGNEE_CHANGED: 'changed the task assignee',
    TASK_DUE_DATE_CHANGED: 'changed the due date',
    TASK_DEPENDENCY_ADDED: 'added a dependency',
    TASK_DEPENDENCY_REMOVED: 'removed a dependency',
    COMMENT_ADDED: 'commented on the task',
  }
  return messages[action] || String(action || '').replaceAll('_', ' ').toLowerCase()
}

function validate(payload, partial = false) {
  const v = {}
  if (!partial || payload.title !== undefined) {
    if (typeof payload.title !== 'string' || !payload.title.trim() || payload.title.trim().length > 180) throw new ApiError(400, 'Task title must be 1-180 characters')
    v.title = payload.title.trim()
  }
  if (payload.description !== undefined) {
    if (typeof payload.description !== 'string' || payload.description.length > 2000) throw new ApiError(400, 'Invalid description')
    v.description = payload.description.trim()
  } else if (!partial) v.description = ''
  if (!partial || payload.priority !== undefined) {
    v.priority = payload.priority || 'MEDIUM'
    if (!priorities.includes(v.priority)) throw new ApiError(400, 'Invalid task priority')
  }
  if (!partial || payload.status !== undefined) {
    v.status = payload.status || 'TODO'
    if (!statuses.includes(v.status)) throw new ApiError(400, 'Invalid task status')
  }
  if (payload.dueDate !== undefined || !partial) {
    if (!payload.dueDate) v.dueDate = null
    else {
      v.dueDate = new Date(payload.dueDate)
      if (Number.isNaN(v.dueDate.getTime())) throw new ApiError(400, 'Invalid due date')
    }
  }
  if (payload.estimateMinutes !== undefined || !partial) {
    const value = payload.estimateMinutes
    if (value === null || value === undefined || value === '') v.estimateMinutes = null
    else {
      if (!Number.isInteger(value) || value < 5 || value > 43200) throw new ApiError(400, 'estimateMinutes must be an integer from 5 to 43200')
      v.estimateMinutes = value
    }
  }
  if (payload.labels !== undefined || !partial) {
    const labels = payload.labels === undefined || payload.labels === null ? [] : payload.labels
    if (!Array.isArray(labels) || labels.length > 20 || labels.some((label) => typeof label !== 'string' || !label.trim() || label.trim().length > 32)) {
      throw new ApiError(400, 'Provide at most 20 non-empty labels of 32 characters or fewer')
    }
    const normalized = labels.map((label) => label.trim())
    if (new Set(normalized.map((label) => label.toLocaleLowerCase('en-US'))).size !== normalized.length) {
      throw new ApiError(400, 'Labels must be unique')
    }
    v.labels = normalized
  }
  for (const field of ['startedAt', 'completedAt']) {
    if (payload[field] !== undefined || !partial) {
      if (payload[field] === null || payload[field] === '') v[field] = null
      else if (payload[field] === undefined && !partial) v[field] = null
      else {
        const date = new Date(payload[field])
        if (Number.isNaN(date.getTime())) throw new ApiError(400, `Invalid ${field}`)
        v[field] = date
      }
    }
  }
  return v
}

const selectTask = `SELECT t.*, p.legacy_mongo_id AS project_legacy_mongo_id,
 a.legacy_mongo_id AS assignee_legacy_mongo_id, u.legacy_mongo_id AS creator_legacy_mongo_id,
 CASE upper(replace(c.name, ' ', '_')) WHEN 'TO_DO' THEN 'TODO' WHEN 'DONE' THEN 'COMPLETED' ELSE upper(replace(c.name, ' ', '_')) END AS status,
 (SELECT count(*)::int FROM task_dependencies td WHERE td.project_id=b.project_id AND td.successor_task_id=t.id) AS blocked_by_count,
 (SELECT count(*)::int FROM task_dependencies td WHERE td.project_id=b.project_id AND td.predecessor_task_id=t.id) AS blocking_count,
 (SELECT COALESCE(jsonb_agg(td.predecessor_task_id ORDER BY td.created_at), '[]'::jsonb) FROM task_dependencies td WHERE td.project_id=b.project_id AND td.successor_task_id=t.id) AS blocked_by_task_ids,
 (SELECT COALESCE(jsonb_agg(td.successor_task_id ORDER BY td.created_at), '[]'::jsonb) FROM task_dependencies td WHERE td.project_id=b.project_id AND td.predecessor_task_id=t.id) AS blocking_task_ids,
 (SELECT COALESCE(jsonb_agg(l.name ORDER BY l.name), '[]'::jsonb) FROM task_labels tl JOIN labels l ON l.id=tl.label_id WHERE tl.task_id=t.id) AS labels
 FROM tasks t JOIN boards b ON b.id=t.board_id
 JOIN projects p ON p.id=b.project_id JOIN board_columns c ON c.id=t.column_id
 LEFT JOIN users a ON a.id=t.assignee_id JOIN users u ON u.id=t.created_by`

function output(row) {
  return { _id: row.legacy_mongo_id || row.id, id: row.id, projectId: row.project_legacy_mongo_id,
    title: row.title, description: row.description, priority: row.priority, status: row.status,
    assigneeId: row.assignee_legacy_mongo_id || null, createdBy: row.creator_legacy_mongo_id,
    dependencyCount: Number(row.blocked_by_count || 0) + Number(row.blocking_count || 0),
    blockedByCount: Number(row.blocked_by_count || 0), blockingCount: Number(row.blocking_count || 0),
    blockedByTaskIds: (row.blocked_by_task_ids || []).map(String), blockingTaskIds: (row.blocking_task_ids || []).map(String),
    hasBlockingDependencies: Number(row.blocked_by_count || 0) > 0, labels: row.labels || [],
    dueDate: row.due_date, estimateMinutes: row.estimate_minutes,
    startedAt: row.started_at, completedAt: row.completed_at,
    version: row.version, createdAt: row.created_at, updatedAt: row.updated_at }
}

export async function createPostgresTask({ pool, userId, role, projectId, payload = {} }) {
  const v = validate(payload)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const access = await resolvePostgresProjectAccess(client, { projectId, userId, role })
    if (access.membership?.project_role === 'VIEWER') throw new ApiError(403, 'Viewers have read-only project access')
    const { boardId, columnId } = await resolvePostgresBoardColumn(client, access.project.id, v.status)
    let assigneeId = null
    if (payload.assigneeId) {
      const legacyAssignee = validateLegacyMongoId(payload.assigneeId, 'assignee id')
      const member = await client.query(`SELECT u.id, pm.project_role FROM users u JOIN project_members pm ON pm.user_id=u.id WHERE u.legacy_mongo_id=$1 AND pm.project_id=$2 AND u.status='ACTIVE'`, [legacyAssignee, access.project.id])
      if (!member.rows[0]) throw new ApiError(422, 'Assignee is not an active project member')
      if (member.rows[0].project_role === 'VIEWER') throw new ApiError(422, 'Viewers cannot be assigned tasks')
      assigneeId = member.rows[0].id
    }
    const inserted = await client.query(`INSERT INTO tasks (board_id,column_id,title,description,priority,assignee_id,created_by,due_date,estimate_minutes,started_at,completed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [boardId,columnId,v.title,v.description,v.priority,assigneeId,access.user.id,v.dueDate,v.estimateMinutes,v.startedAt,v.completedAt])
    for (const labelName of v.labels) {
      const label = await client.query(
        `INSERT INTO labels (board_id,name) VALUES ($1,$2)
         ON CONFLICT (board_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
        [boardId,labelName],
      )
      await client.query(
        'INSERT INTO task_labels (task_id,label_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [inserted.rows[0].id,label.rows[0].id],
      )
    }
    // Match MongoDB task-assignment notifications and honor each recipient's preference.
    if (assigneeId) {
      await client.query(
        `INSERT INTO notifications (user_id,type,message,entity_id)
         SELECT u.id,'TASK_ASSIGNED',$2,$3
           FROM users u
          WHERE u.id=$1
            AND COALESCE((u.preferences #>> '{notifications,taskAssignment}')::boolean,true)`,
        [assigneeId, 'A new task was assigned to you: ' + v.title, inserted.rows[0].id],
      )
    }
    await client.query(`INSERT INTO activity_history (project_id,task_id,actor_id,action,after_state) VALUES ($1,$2,$3,'TASK_CREATED',$4::jsonb)`,
      [access.project.id,inserted.rows[0].id,access.user.id,JSON.stringify({title:v.title,status:v.status,priority:v.priority})])
    const result = await client.query(`${selectTask} WHERE t.id=$1`, [inserted.rows[0].id])
    await client.query('COMMIT')
    return output(result.rows[0])
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
}

export async function listPostgresTasks({ pool, userId, role, projectId, query = {} }) {
  const page = query.page === undefined ? 1 : Number(query.page)
  const limit = query.limit === undefined ? 100 : Number(query.limit)
  if (!Number.isInteger(page) || page < 1) throw new ApiError(400, 'page must be positive')
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, 'limit must be 1-100')
  if (query.status && !statuses.includes(query.status)) throw new ApiError(400, 'Invalid task status filter')
  if (query.priority && !priorities.includes(query.priority)) throw new ApiError(400, 'Invalid priority filter')
  const parseDateFilter = (value, field) => {
    if (value === undefined || value === '') return null
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) throw new ApiError(400, `${field} must be a valid date`)
    return parsed
  }
  const dueDateFrom = parseDateFilter(query.dueDateFrom, 'dueDateFrom')
  const dueDateTo = parseDateFilter(query.dueDateTo, 'dueDateTo')
  if (dueDateFrom && dueDateTo && dueDateFrom > dueDateTo) {
    throw new ApiError(400, 'dueDateFrom must be on or before dueDateTo')
  }
  if (query.label !== undefined && (typeof query.label !== 'string' || !query.label.trim() || query.label.trim().length > 32)) {
    throw new ApiError(400, 'label must be 1-32 characters')
  }
  const client = await pool.connect()
  try {
    const access = await resolvePostgresProjectAccess(client, { projectId, userId, role })
    const params = [access.project.id]
    const filters = ['b.project_id=$1']
    if (query.status) { params.push(query.status); filters.push(`(CASE upper(replace(c.name, ' ', '_')) WHEN 'TO_DO' THEN 'TODO' WHEN 'DONE' THEN 'COMPLETED' ELSE upper(replace(c.name, ' ', '_')) END)=$${params.length}`) }
    if (query.priority) { params.push(query.priority); filters.push(`t.priority=$${params.length}`) }
    if (query.assigneeId !== undefined) {
      if (query.assigneeId === 'unassigned') filters.push('t.assignee_id IS NULL')
      else {
        params.push(validateLegacyMongoId(query.assigneeId, 'assignee id'))
        filters.push(`a.legacy_mongo_id=${params.length}`)
      }
    }
    if (query.overdue !== undefined && !['true','false',true,false].includes(query.overdue)) throw new ApiError(400, 'overdue must be true or false')
    const overdueOnly = query.overdue === true || query.overdue === 'true'
    if (overdueOnly) {
      // Match MongoDB listTasks semantics: overdue takes precedence over date-range filters.
      filters.push('t.due_date < now()')
    } else {
      if (dueDateFrom) {
        params.push(dueDateFrom.toISOString())
        filters.push(`t.due_date >= $${params.length}::timestamptz`)
      }
      if (dueDateTo) {
        params.push(dueDateTo.toISOString())
        filters.push(`t.due_date <= $${params.length}::timestamptz`)
      }
    }
    if (query.label !== undefined) {
      params.push(query.label.trim())
      filters.push(`EXISTS (
        SELECT 1 FROM task_labels tl JOIN labels l ON l.id = tl.label_id
        WHERE tl.task_id = t.id AND l.name = $${params.length}
      )`)
    }
    const where = filters.join(' AND ')
    const count = await client.query(`SELECT count(*)::int AS total FROM tasks t JOIN boards b ON b.id=t.board_id JOIN board_columns c ON c.id=t.column_id LEFT JOIN users a ON a.id=t.assignee_id WHERE ${where}`, params)
    const total = count.rows[0].total
    const rows = await client.query(`${selectTask} WHERE ${where} ORDER BY t.due_date ASC NULLS LAST,t.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`,
      [...params,limit,(page-1)*limit])
    return { tasks: rows.rows.map(output), pagination: { page, limit, total, pages: Math.ceil(total/limit), hasNextPage: page*limit<total, hasPreviousPage: page>1 } }
  } finally { client.release() }
}

export async function updatePostgresTask({ pool, userId, role, taskId, payload = {} }) {
  const legacyTaskId = String(taskId ?? '')
  if (!/^(?:[a-f\d]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(legacyTaskId)) throw new ApiError(400, 'Invalid task id')
  const v = validate(payload, true)
  if (payload.version !== undefined && (!Number.isInteger(payload.version) || payload.version < 1)) throw new ApiError(400, 'version must be positive')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const found = await client.query(`${selectTask} WHERE t.legacy_mongo_id=$1 OR t.id::text=$1 FOR UPDATE OF t`, [legacyTaskId])
    const task = found.rows[0]
    if (!task) throw new ApiError(404, 'Task not found in PostgreSQL')
    const access = await resolvePostgresProjectAccess(client, { projectId: task.project_legacy_mongo_id, userId, role })
    if (access.membership?.project_role === 'VIEWER') throw new ApiError(403, 'Viewers have read-only project access')
    const version = payload.version ?? task.version
    if (version !== task.version) throw new ApiError(409, 'Task was changed by another user. Refresh and retry.')
    const status = v.status ?? task.status
    if (payload.status && ['IN_PROGRESS','REVIEW','COMPLETED'].includes(status)) {
      const blockers = await client.query(
        `SELECT pre.title FROM task_dependencies d
         JOIN tasks pre ON pre.id=d.predecessor_task_id
         JOIN board_columns pre_col ON pre_col.id=pre.column_id
         WHERE d.project_id=$1 AND d.successor_task_id=$2
         AND upper(replace(pre_col.name,' ','_')) NOT IN ('DONE','COMPLETED')
         ORDER BY d.created_at LIMIT 3`,
        [access.project.id,task.id],
      )
      if (blockers.rowCount) throw new ApiError(409, 'Task is blocked by: ' + blockers.rows.map((row) => row.title).join(', '))
    }
    const { columnId } = await resolvePostgresBoardColumn(client, access.project.id, status)
    let assigneeId = task.assignee_id
    if (payload.assigneeId !== undefined) {
      if (payload.assigneeId === null || payload.assigneeId === '') assigneeId = null
      else {
        const legacyAssigneeId = validateLegacyMongoId(payload.assigneeId, 'assignee id')
        const member = await client.query(`SELECT u.id,pm.project_role FROM users u JOIN project_members pm ON pm.user_id=u.id WHERE u.legacy_mongo_id=$1 AND pm.project_id=$2 AND u.status='ACTIVE'`, [legacyAssigneeId, access.project.id])
        if (!member.rows[0]) throw new ApiError(422, 'Assignee is not an active project member')
        if (member.rows[0].project_role === 'VIEWER') throw new ApiError(422, 'Viewers cannot be assigned tasks')
        assigneeId = member.rows[0].id
      }
    }
    const updated = await client.query(`UPDATE tasks SET column_id=$1,title=$2,description=$3,priority=$4,due_date=$5,estimate_minutes=$6,started_at=$7,completed_at=$8,assignee_id=$9,version=version+1,updated_at=now() WHERE id=$10 AND version=$11 RETURNING id`,
      [columnId,v.title ?? task.title,v.description ?? task.description,v.priority ?? task.priority,
        Object.hasOwn(v,'dueDate') ? v.dueDate : task.due_date,
        Object.hasOwn(v,'estimateMinutes') ? v.estimateMinutes : task.estimate_minutes,
        Object.hasOwn(v,'startedAt') ? v.startedAt : task.started_at,
        Object.hasOwn(v,'completedAt') ? v.completedAt : task.completed_at,
        assigneeId,task.id,version])
    if (!updated.rows[0]) throw new ApiError(409, 'Task was changed by another user. Refresh and retry.')
    if (Object.hasOwn(v, 'labels')) {
      await client.query('DELETE FROM task_labels WHERE task_id=$1', [task.id])
      for (const labelName of v.labels) {
        const label = await client.query(
          `INSERT INTO labels (board_id,name) VALUES ($1,$2)
           ON CONFLICT (board_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
          [task.board_id,labelName],
        )
        await client.query(
          'INSERT INTO task_labels (task_id,label_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [task.id,label.rows[0].id],
        )
      }
    }
    await client.query(`INSERT INTO activity_history (project_id,task_id,actor_id,action,before_state,after_state) VALUES ($1,$2,$3,'TASK_UPDATED',$4::jsonb,$5::jsonb)`,
      [access.project.id,task.id,access.user.id,JSON.stringify({title:task.title,status:task.status,version:task.version}),JSON.stringify({title:v.title ?? task.title,status,version:task.version+1})])
    if (assigneeId && assigneeId !== task.assignee_id) {
      await client.query(
        `INSERT INTO notifications (user_id,type,message,entity_id)
         SELECT u.id,'TASK_ASSIGNED',$2,$3
           FROM users u
          WHERE u.id=$1
            AND COALESCE((u.preferences #>> '{notifications,taskAssignment}')::boolean,true)`,
        [assigneeId, 'A task was assigned to you: ' + (v.title ?? task.title), task.id],
      )
    }
    const result = await client.query(`${selectTask} WHERE t.id=$1`, [task.id])
    await client.query('COMMIT')
    return output(result.rows[0])
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally { client.release() }
}

export async function deletePostgresTask({ pool, taskId, userId, role }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const found = await client.query(
      `SELECT t.id, t.legacy_mongo_id, p.legacy_mongo_id AS project_legacy_id
         FROM tasks t
         JOIN boards b ON b.id=t.board_id
         JOIN projects p ON p.id=b.project_id
        WHERE t.id::text=$1 OR t.legacy_mongo_id=$1
        LIMIT 1 FOR UPDATE OF t`,
      [String(taskId)],
    )
    const task = found.rows[0]
    if (!task) throw new ApiError(404, 'Task not found')
    const access = await resolvePostgresProjectAccess(client, { projectId: task.project_legacy_id, userId, role })
    if (access.membership?.project_role === 'VIEWER') throw new ApiError(403, 'Viewers have read-only project access')
    await client.query('DELETE FROM task_dependencies WHERE predecessor_task_id=$1 OR successor_task_id=$1', [task.id])
    await client.query('DELETE FROM task_labels WHERE task_id=$1', [task.id])
    await client.query('DELETE FROM comments WHERE task_id=$1', [task.id])
    await client.query('DELETE FROM activity_history WHERE task_id=$1', [task.id])
    await client.query("DELETE FROM activity_logs WHERE entity_type='TASK' AND entity_id=$1", [task.id])
    await client.query("DELETE FROM notifications WHERE entity_id=$1", [task.id])
    await client.query('DELETE FROM tasks WHERE id=$1', [task.id])
    await client.query('COMMIT')
    return { id: task.id, _id: task.legacy_mongo_id || task.id, deleted: true }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    if (error.code === '23503') throw new ApiError(409, 'This task is still referenced by another record and cannot be deleted yet')
    throw error
  } finally {
    client.release()
  }
}

export async function listPostgresTaskActivity({ pool, taskId, userId, role }) {
  const client = await pool.connect()
  try {
    const found = await client.query(
      `SELECT t.id, p.legacy_mongo_id AS project_legacy_id
         FROM tasks t
         JOIN boards b ON b.id=t.board_id
         JOIN projects p ON p.id=b.project_id
        WHERE t.id::text=$1 OR t.legacy_mongo_id=$1
        LIMIT 1`,
      [String(taskId)],
    )
    const task = found.rows[0]
    if (!task) throw new ApiError(404, 'Task not found')
    await resolvePostgresProjectAccess(client, {
      projectId: task.project_legacy_id,
      userId,
      role,
    })
    const activityResult = await client.query(
      `SELECT a.id, a.action, a.before_state, a.after_state, a.created_at,
              a.actor_id, actor.legacy_mongo_id AS actor_legacy_id,
              actor.name AS actor_name, a.task_id
         FROM activity_history a
         JOIN users actor ON actor.id=a.actor_id
        WHERE a.task_id=$1
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT 100`,
      [task.id],
    )
    const auditLogResult = await client.query(
      `SELECT l.id, l.action, l.metadata, l.created_at,
              actor.legacy_mongo_id AS actor_legacy_id, actor.name AS actor_name
         FROM activity_logs l
         JOIN users actor ON actor.id=l.user_id
        WHERE l.entity_type='TASK' AND l.entity_id=$1
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT 100`,
      [task.id],
    )
    const commentResult = await client.query(
      `SELECT c.id, c.body, c.created_at,
              author.legacy_mongo_id AS author_legacy_id,
              author.name AS author_name, author.email AS author_email,
              author.role AS author_role
         FROM comments c
         JOIN users author ON author.id=c.author_id
        WHERE c.task_id=$1
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT 100`,
      [task.id],
    )
    const events = [
      ...activityResult.rows.map(row => ({
        id: 'activity-' + String(row.id),
        type: 'activity',
        action: row.action,
        message: formatTaskActivity(row.action),
        metadata: { ...(row.before_state ? { before: row.before_state } : {}), ...(row.after_state ? { after: row.after_state } : {}) },
        user: { id: row.actor_legacy_id, name: row.actor_name },
        createdAt: row.created_at,
      })),
      ...auditLogResult.rows.map(row => ({
        id: 'activity-' + String(row.id),
        type: 'activity',
        action: row.action,
        message: formatTaskActivity(row.action),
        metadata: row.metadata || {},
        user: { id: row.actor_legacy_id, name: row.actor_name },
        createdAt: row.created_at,
      })),
      ...commentResult.rows.map(row => ({
        id: 'comment-' + String(row.id),
        type: 'comment',
        action: 'COMMENT_ADDED',
        message: row.body,
        user: { _id: row.author_legacy_id, id: row.author_legacy_id, name: row.author_name, email: row.author_email, role: row.author_role },
        createdAt: row.created_at,
      })),
    ]
    return events
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .slice(-150)
  } finally {
    client.release()
  }
}

