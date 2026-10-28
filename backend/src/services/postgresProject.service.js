import { randomBytes } from 'node:crypto'
import { ApiError } from '../utils/apiError.js'

const STATUSES = new Set(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'])
const ROLES = new Set(['ADMINISTRATOR', 'PROJECT_MANAGER', 'TEAM_MEMBER'])
const DEFAULT_COLUMNS = [
  ['To Do', 0, false],
  ['In Progress', 1, false],
  ['Review', 2, false],
  ['Done', 3, true],
]

function parseDate(value, field) {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new ApiError(400, `Invalid ${field}`)
  return date.toISOString().slice(0, 10)
}

function projectDto(row, membershipRole = null) {
  return {
    id: row.id,
    _id: row.legacy_mongo_id,
    name: row.name,
    description: row.description,
    ownerId: row.owner_legacy_mongo_id || row.owner_id,
    status: row.status,
    startDate: row.start_date,
    dueDate: row.due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    projectRole: membershipRole || (row.is_owner ? 'PROJECT_MANAGER' : null),
  }
}

async function syncAuthenticatedUser(client, user) {
  const legacyUserId = String(user.id || '')
  if (!/^[a-f\d]{24}$/i.test(legacyUserId)) throw new ApiError(401, 'Authenticated account has an invalid identifier')
  const role = ROLES.has(user.role) ? user.role : 'TEAM_MEMBER'
  const email = String(user.email || '').trim().toLowerCase()
  const name = String(user.name || '').trim()
  if (!email || !name) throw new ApiError(401, 'Authenticated account is missing required profile fields')
  const result = await client.query(
    `INSERT INTO users (name,email,password_hash,role,status,legacy_mongo_id)
     VALUES ($1,$2,$3,$4,'ACTIVE',$5)
     ON CONFLICT (legacy_mongo_id) WHERE legacy_mongo_id IS NOT NULL DO UPDATE
       SET name=EXCLUDED.name, email=EXCLUDED.email, role=EXCLUDED.role, status='ACTIVE', updated_at=now()
     RETURNING id, legacy_mongo_id, role`,
    [name, email, 'AUTH_MANAGED_BY_MONGODB_DURING_STAGED_MIGRATION', role, legacyUserId],
  )
  return result.rows[0]
}

async function withTransaction(pool, work) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    if (error.code === '23505') throw new ApiError(409, 'A project or account with these details already exists')
    if (error.code === '23503') throw new ApiError(400, 'Project references an unavailable account or record')
    throw error
  } finally {
    client.release()
  }
}

async function findAccessibleProject(client, { projectId, userId, role, lock = false }) {
  const id = String(projectId || '')
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  const isLegacyId = /^[a-f\d]{24}$/i.test(id)
  if (!isUuid && !isLegacyId) throw new ApiError(400, 'Invalid project id')
  const result = await client.query(
    `SELECT p.*, owner.legacy_mongo_id AS owner_legacy_mongo_id,
       (p.owner_id = $2) AS is_owner,
       pm.project_role AS membership_role
     FROM projects p
     JOIN users owner ON owner.id = p.owner_id
     LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $2
     WHERE ${isUuid ? 'p.id::text = $1' : 'p.legacy_mongo_id = $1'}
       AND ($3 = 'ADMINISTRATOR' OR p.owner_id = $2 OR pm.user_id IS NOT NULL)
     ${lock ? 'FOR UPDATE OF p' : ''}`,
    [id, userId, role],
  )
  if (!result.rows[0]) {
    const exists = await client.query(
      `SELECT id FROM projects WHERE ${isUuid ? 'id::text = $1' : 'legacy_mongo_id = $1'}`,
      [id],
    )
    if (exists.rows[0]) throw new ApiError(403, 'You are not a member of this project')
    throw new ApiError(404, 'Project not found')
  }
  return result.rows[0]
}

export async function createPostgresProject({ pool, user, payload = {} }) {
  const name = String(payload.name || '').trim()
  if (!name) throw new ApiError(400, 'Project name is required')
  if (name.length > 120) throw new ApiError(400, 'Project name is too long')
  const description = String(payload.description || '').trim()
  if (description.length > 1000) throw new ApiError(400, 'Project description is too long')
  const status = payload.status || 'PLANNING'
  if (!STATUSES.has(status)) throw new ApiError(400, 'Invalid project status')
  const startDate = parseDate(payload.startDate, 'start date') ?? null
  const dueDate = parseDate(payload.dueDate, 'due date') ?? null
  if (startDate && dueDate && dueDate < startDate) throw new ApiError(400, 'Due date cannot be before start date')

  return withTransaction(pool, async (client) => {
    const owner = await syncAuthenticatedUser(client, user)
    const legacyProjectId = randomBytes(12).toString('hex')
    const inserted = await client.query(
      `INSERT INTO projects (name,description,owner_id,status,start_date,due_date,legacy_mongo_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, description, owner.id, status, startDate, dueDate, legacyProjectId],
    )
    const project = inserted.rows[0]
    await client.query(
      `INSERT INTO project_members (project_id,user_id,project_role)
       VALUES ($1,$2,'PROJECT_MANAGER') ON CONFLICT (project_id,user_id) DO NOTHING`,
      [project.id, owner.id],
    )
    const board = await client.query(
      `INSERT INTO boards (project_id,name,description,created_by)
       VALUES ($1,'Main Board','Default board created with project',$2) RETURNING id`,
      [project.id, owner.id],
    )
    for (const [columnName, position, isDone] of DEFAULT_COLUMNS) {
      await client.query(
        'INSERT INTO board_columns (board_id,name,position,is_done) VALUES ($1,$2,$3,$4)',
        [board.rows[0].id, columnName, position, isDone],
      )
    }
    const response = await client.query(
      `SELECT p.*, u.legacy_mongo_id AS owner_legacy_mongo_id, true AS is_owner
       FROM projects p JOIN users u ON u.id=p.owner_id WHERE p.id=$1`,
      [project.id],
    )
    return projectDto(response.rows[0], 'PROJECT_MANAGER')
  })
}

export async function listPostgresProjects({ pool, user }) {
  return withTransaction(pool, async (client) => {
    const account = await syncAuthenticatedUser(client, user)
    const result = await client.query(
      `SELECT p.*, owner.legacy_mongo_id AS owner_legacy_mongo_id,
        (p.owner_id=$1) AS is_owner, pm.project_role AS membership_role
       FROM projects p
       JOIN users owner ON owner.id=p.owner_id
       LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=$1
       WHERE ($2='ADMINISTRATOR' OR p.owner_id=$1 OR pm.user_id IS NOT NULL)
       ORDER BY p.created_at DESC, p.id`,
      [account.id, user.role],
    )
    return result.rows.map((row) => projectDto(row, row.membership_role))
  })
}

export async function getPostgresProject({ pool, user, projectId }) {
  return withTransaction(pool, async (client) => {
    const account = await syncAuthenticatedUser(client, user)
    const project = await findAccessibleProject(client, { projectId, userId: account.id, role: user.role })
    return projectDto(project, project.membership_role)
  })
}

export async function updatePostgresProject({ pool, user, projectId, payload = {} }) {
  return withTransaction(pool, async (client) => {
    const account = await syncAuthenticatedUser(client, user)
    const project = await findAccessibleProject(client, { projectId, userId: account.id, role: user.role, lock: true })
    if (user.role !== 'ADMINISTRATOR' && project.owner_id !== account.id && project.membership_role !== 'PROJECT_MANAGER') {
      throw new ApiError(403, 'Only the project owner or project manager can update this project')
    }
    const nextStartDate = payload.startDate !== undefined
      ? parseDate(payload.startDate, 'start date')
      : project.start_date
    const nextDueDate = payload.dueDate !== undefined
      ? parseDate(payload.dueDate, 'due date')
      : project.due_date
    if (nextStartDate && nextDueDate && nextDueDate < nextStartDate) {
      throw new ApiError(400, 'Due date cannot be before start date')
    }

    const fields = []
    const values = []
    const add = (column, value) => { values.push(value); fields.push(`${column}=$${values.length}`) }
    if (payload.name !== undefined) {
      const name = String(payload.name || '').trim()
      if (!name) throw new ApiError(400, 'Project name is required')
      if (name.length > 120) throw new ApiError(400, 'Project name is too long')
      add('name', name)
    }
    if (payload.description !== undefined) {
      const description = String(payload.description || '').trim()
      if (description.length > 1000) throw new ApiError(400, 'Project description is too long')
      add('description', description)
    }
    if (payload.status !== undefined) {
      if (!STATUSES.has(payload.status)) throw new ApiError(400, 'Invalid project status')
      add('status', payload.status)
    }
    if (payload.startDate !== undefined) add('start_date', parseDate(payload.startDate, 'start date'))
    if (payload.dueDate !== undefined) add('due_date', parseDate(payload.dueDate, 'due date'))
    if (fields.length) {
      values.push(project.id)
      await client.query(`UPDATE projects SET ${fields.join(', ')}, updated_at=now() WHERE id=$${values.length}`, values)
    }
    const refreshed = await findAccessibleProject(client, { projectId: project.id, userId: account.id, role: user.role })
    if (refreshed.start_date && refreshed.due_date && refreshed.due_date < refreshed.start_date) {
      throw new ApiError(400, 'Due date cannot be before start date')
    }
    return projectDto(refreshed, refreshed.membership_role)
  })
}

export async function deletePostgresProject({ pool, user, projectId }) {
  return withTransaction(pool, async (client) => {
    const account = await syncAuthenticatedUser(client, user)
    const project = await findAccessibleProject(client, { projectId, userId: account.id, role: user.role, lock: true })
    if (user.role !== 'ADMINISTRATOR' && project.owner_id !== account.id) {
      throw new ApiError(403, 'Only the project owner can delete this project')
    }
    await client.query('DELETE FROM projects WHERE id=$1', [project.id])
    return { id: project.id, _id: project.legacy_mongo_id, deleted: true }
  })
}

const MEMBER_ROLES = new Set(['PROJECT_MANAGER','MEMBER','VIEWER'])

async function assertManageMembers(client, project, account, role) {
  if (role === 'ADMINISTRATOR' || project.owner_id === account.id) return
  const membership = await client.query(
    'SELECT project_role FROM project_members WHERE project_id=$1 AND user_id=$2',
    [project.id, account.id],
  )
  if (membership.rows[0]?.project_role !== 'PROJECT_MANAGER') {
    throw new ApiError(403, 'Only the project owner, administrator, or project manager can manage this team')
  }
}

export async function searchPostgresProjectMemberCandidates({ pool, user, projectId, query = '' }) {
  const term = String(query || '').trim()
  return withTransaction(pool, async (client) => {
    const account = await syncAuthenticatedUser(client, user)
    const project = await findAccessibleProject(client, { projectId, userId: account.id, role: user.role })
    await assertManageMembers(client, project, account, user.role)
    if (term.length < 2) return []
    const result = await client.query(
      `SELECT u.id,u.legacy_mongo_id,u.name,u.email,u.role,u.status
       FROM users u
       WHERE u.status='ACTIVE'
         AND (position(lower($1) in lower(u.name)) > 0 OR position(lower($1) in lower(u.email)) > 0)
         AND NOT EXISTS (
           SELECT 1 FROM project_members pm WHERE pm.project_id=$2 AND pm.user_id=u.id
         )
       ORDER BY u.name
       LIMIT 10`,
      [term, project.id],
    )
    return result.rows.map((row) => ({
      _id: row.legacy_mongo_id || row.id,
      id: row.id,
      userId: row.legacy_mongo_id || row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      status: row.status,
    }))
  })
}

export async function getPostgresAssignmentSuggestions({ pool, user, projectId, priority = 'MEDIUM', dueDate = null, estimateMinutes = null }) {
  const priorities = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  if (!priorities.has(priority)) throw new ApiError(400, 'Invalid task priority')
  if (estimateMinutes !== null && estimateMinutes !== undefined &&
      (!Number.isInteger(Number(estimateMinutes)) || Number(estimateMinutes) < 5 || Number(estimateMinutes) > 43200)) {
    throw new ApiError(400, 'estimateMinutes must be an integer from 5 to 43200')
  }
  const effectiveDue = dueDate ? new Date(dueDate) : null
  if (effectiveDue && Number.isNaN(effectiveDue.getTime())) throw new ApiError(400, 'Invalid due date')
  return withTransaction(pool, async (client) => {
    const account = await syncAuthenticatedUser(client, user)
    const project = await findAccessibleProject(client, { projectId, userId: account.id, role: user.role })
    const result = await client.query(
      `SELECT u.id,u.legacy_mongo_id,u.name,u.email,u.role,pm.project_role,
         count(t.id) FILTER (WHERE t.id IS NOT NULL)::int AS active_count,
         COALESCE(sum(COALESCE(t.estimate_minutes,60)) FILTER (WHERE t.id IS NOT NULL),0)::int AS active_minutes,
         count(t.id) FILTER (WHERE t.priority IN ('HIGH','CRITICAL') AND t.due_date < now() + interval '72 hours')::int AS high_priority_conflicts,
         count(t.id) FILTER (WHERE $2::timestamptz IS NOT NULL AND t.due_date IS NOT NULL
           AND abs(extract(epoch FROM (t.due_date::timestamptz - $2::timestamptz))) <= 259200)::int AS due_conflicts
       FROM project_members pm JOIN users u ON u.id=pm.user_id
       LEFT JOIN tasks t ON t.assignee_id=u.id AND t.board_id IN (SELECT id FROM boards WHERE project_id=pm.project_id)
         AND t.column_id IN (SELECT id FROM board_columns WHERE is_done=false)
       WHERE pm.project_id=$1 AND pm.project_role <> 'VIEWER' AND u.status='ACTIVE'
       GROUP BY u.id,u.legacy_mongo_id,u.name,u.email,u.role,pm.project_role
       ORDER BY u.name`,
      [project.id, effectiveDue ? effectiveDue.toISOString() : null],
    )
    if (!result.rows.length) return []
    const maxLoad = Math.max(...result.rows.map((row) => Number(row.active_count || 0)), 0)
    const clamp = (value) => Math.min(1, Math.max(0, value))
    const scored = result.rows.map((row) => {
      const activeCount = Number(row.active_count || 0)
      const activeMinutes = Number(row.active_minutes || 0)
      const workloadFit = maxLoad === 0 ? 1 : clamp(1 - activeCount / Math.max(maxLoad, 1))
      const dueDateFit = effectiveDue ? clamp(1 - Number(row.due_conflicts || 0) / Math.max(activeCount, 1)) : 1
      const roleFit = ['HIGH','CRITICAL'].includes(priority)
        ? (row.project_role === 'PROJECT_MANAGER' ? 1 : 0.9)
        : (row.project_role === 'MEMBER' ? 1 : 0.9)
      const priorityFit = clamp(1 - Number(row.high_priority_conflicts || 0) / 2)
      const projectedMinutes = Number(estimateMinutes || 60)
      const availabilityFit = clamp(1 - Math.max(0, activeMinutes + projectedMinutes - 480) / 960)
      const assignmentScore = Number((0.30 * workloadFit + 0.25 * dueDateFit + 0.20 * roleFit + 0.15 * priorityFit + 0.10 * availabilityFit).toFixed(3))
      const reasons = []
      if (workloadFit >= 0.8) reasons.push('workload is low')
      else if (workloadFit < 0.5) reasons.push('workload is high')
      if (roleFit >= 0.95) reasons.push('role matches')
      if (dueDateFit >= 0.8) reasons.push('no near-term due conflict')
      else if (dueDateFit < 0.5) reasons.push('several due-date conflicts')
      if (priorityFit >= 0.8) reasons.push('priority load is manageable')
      if (availabilityFit >= 0.8) reasons.push('availability looks healthy')
      return {
        userId: row.legacy_mongo_id || row.id,
        user: { name: row.name, email: row.email, role: row.role },
        projectRole: row.project_role,
        activeTaskCount: activeCount,
        activeMinutes,
        workloadFit,
        dueDateFit,
        roleFit,
        priorityFit,
        availabilityFit,
        assignmentScore,
        reason: reasons.slice(0, 3).join(', ') || 'best available workload profile',
      }
    })
    return scored.sort((a, b) => b.assignmentScore - a.assignmentScore).slice(0, 3)
  })
}

export async function getPostgresTaskAssignmentSuggestions({ pool, user, taskId }) {
  const id = String(taskId || '')
  const isLegacyId = /^[a-f\d]{24}$/i.test(id)
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  if (!isLegacyId && !isUuid) throw new ApiError(400, 'Invalid task id')
  const result = await pool.query(
    `SELECT t.priority,t.due_date,t.estimate_minutes,p.legacy_mongo_id AS project_legacy_id,p.id AS project_id
     FROM tasks t JOIN boards b ON b.id=t.board_id JOIN projects p ON p.id=b.project_id
     WHERE ${isLegacyId ? 't.legacy_mongo_id=$1' : 't.id::text=$1'} LIMIT 1`,
    [id],
  )
  const task = result.rows[0]
  if (!task) throw new ApiError(404, 'Task not found')
  return getPostgresAssignmentSuggestions({
    pool, user, projectId: task.project_legacy_id || task.project_id,
    priority: task.priority, dueDate: task.due_date, estimateMinutes: task.estimate_minutes,
  })
}

export async function listPostgresProjectMembers({ pool, user, projectId }) {
  return withTransaction(pool, async (client) => {
    const account = await syncAuthenticatedUser(client, user)
    const project = await findAccessibleProject(client, { projectId, userId: account.id, role: user.role })
    const result = await client.query(
      `SELECT u.id,u.legacy_mongo_id,u.name,u.email,u.role,u.status,pm.project_role,pm.joined_at
       FROM project_members pm JOIN users u ON u.id=pm.user_id
       WHERE pm.project_id=$1 ORDER BY pm.project_role,u.name`,
      [project.id],
    )
    return result.rows.map((row) => ({
      id: row.id, userId: row.legacy_mongo_id || row.id, name: row.name, email: row.email,
      role: row.role, status: row.status, projectRole: row.project_role, joinedAt: row.joined_at,
    }))
  })
}

export async function addPostgresProjectMember({ pool, user, projectId, memberUserId, projectRole = 'MEMBER' }) {
  if (!MEMBER_ROLES.has(projectRole)) throw new ApiError(400, 'Invalid project role')
  return withTransaction(pool, async (client) => {
    const account = await syncAuthenticatedUser(client, user)
    const project = await findAccessibleProject(client, { projectId, userId: account.id, role: user.role, lock: true })
    await assertManageMembers(client, project, account, user.role)
    const requestedMemberId = String(memberUserId || '')
    const isLegacyId = /^[a-f\d]{24}$/i.test(requestedMemberId)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(requestedMemberId)
    if (!isLegacyId && !isUuid) throw new ApiError(400, 'Invalid member id')
    const memberResult = await client.query(
      `SELECT id,legacy_mongo_id,name,email,role,status FROM users
       WHERE ${isLegacyId ? 'legacy_mongo_id=$1' : 'id::text=$1'} AND status='ACTIVE'`,
      [requestedMemberId],
    )
    const member = memberResult.rows[0]
    if (!member) throw new ApiError(404, 'User not found or inactive')
    if (member.id === project.owner_id) throw new ApiError(409, 'Project owner is already a member')
    const inserted = await client.query(
      `INSERT INTO project_members (project_id,user_id,project_role)
       VALUES ($1,$2,$3) ON CONFLICT (project_id,user_id) DO NOTHING
       RETURNING project_role,joined_at`,
      [project.id,member.id,projectRole],
    )
    if (!inserted.rowCount) throw new ApiError(409, 'User is already a member of this project')
    await client.query(
      `INSERT INTO notifications (user_id,type,message,entity_id)
       VALUES ($1,'PROJECT_MEMBER_ADDED',$2,$3)`,
      [member.id, `You were added to the project "${project.name}" with ${projectRole.replaceAll('_',' ').toLowerCase()} permissions.`, project.id],
    )
    await client.query(
      `INSERT INTO activity_logs (user_id,action,entity_type,entity_id,metadata)
       VALUES ($1,'PROJECT_MEMBER_ADDED','PROJECT',$2,$3::jsonb)`,
      [account.id,project.id,JSON.stringify({ memberUserId: member.legacy_mongo_id || member.id, projectRole })],
    )
    return { userId: member.legacy_mongo_id || member.id, name: member.name, email: member.email, projectRole, joinedAt: inserted.rows[0].joined_at }
  })
}

export async function updatePostgresProjectMemberRole({ pool, user, projectId, memberUserId, projectRole }) {
  if (!MEMBER_ROLES.has(projectRole)) throw new ApiError(400, 'Invalid project role')
  return withTransaction(pool, async (client) => {
    const account = await syncAuthenticatedUser(client, user)
    const project = await findAccessibleProject(client, { projectId, userId: account.id, role: user.role, lock: true })
    await assertManageMembers(client, project, account, user.role)
    const requestedMemberId = String(memberUserId || '')
    const isLegacyId = /^[a-f\d]{24}$/i.test(requestedMemberId)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedMemberId)
    if (!isLegacyId && !isUuid) throw new ApiError(400, 'Invalid member id')
    const member = await client.query(
      `SELECT id,legacy_mongo_id,name,email FROM users WHERE ${isLegacyId ? 'legacy_mongo_id=$1' : 'id::text=$1'}`,
      [requestedMemberId],
    )
    if (!member.rows[0]) throw new ApiError(404, 'Project member not found')
    if (member.rows[0].id === project.owner_id) throw new ApiError(400, 'The project owner always retains owner permissions')
    const updated = await client.query(
      'UPDATE project_members SET project_role=$1 WHERE project_id=$2 AND user_id=$3 RETURNING joined_at',
      [projectRole,project.id,member.rows[0].id],
    )
    if (!updated.rowCount) throw new ApiError(404, 'Project member not found')
    await client.query(
      `INSERT INTO activity_logs (user_id,action,entity_type,entity_id,metadata)
       VALUES ($1,'PROJECT_MEMBER_ROLE_UPDATED','PROJECT',$2,$3::jsonb)`,
      [account.id,project.id,JSON.stringify({ memberUserId, projectRole })],
    )
    return { userId: memberUserId, name: member.rows[0].name, email: member.rows[0].email, projectRole, joinedAt: updated.rows[0].joined_at }
  })
}

export async function removePostgresProjectMember({ pool, user, projectId, memberUserId }) {
  return withTransaction(pool, async (client) => {
    const account = await syncAuthenticatedUser(client, user)
    const project = await findAccessibleProject(client, { projectId, userId: account.id, role: user.role, lock: true })
    await assertManageMembers(client, project, account, user.role)
    if (memberUserId === project.owner_legacy_mongo_id || memberUserId === project.owner_id) throw new ApiError(400, 'The project owner cannot be removed from the project')
    if (memberUserId === String(user.id)) throw new ApiError(400, 'You cannot remove yourself from the project')
    const requestedMemberId = String(memberUserId || '')
    const isLegacyId = /^[a-f\d]{24}$/i.test(requestedMemberId)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedMemberId)
    if (!isLegacyId && !isUuid) throw new ApiError(400, 'Invalid member id')
    const member = await client.query(
      `SELECT id FROM users WHERE ${isLegacyId ? 'legacy_mongo_id=$1' : 'id::text=$1'}`,
      [requestedMemberId],
    )
    if (!member.rows[0]) throw new ApiError(404, 'Project member not found')
    const deleted = await client.query('DELETE FROM project_members WHERE project_id=$1 AND user_id=$2 RETURNING user_id', [project.id,member.rows[0].id])
    if (!deleted.rowCount) throw new ApiError(404, 'Project member not found')
    await client.query(
      'UPDATE tasks SET assignee_id=NULL WHERE assignee_id=$1 AND board_id IN (SELECT id FROM boards WHERE project_id=$2)',
      [member.rows[0].id,project.id],
    )
    await client.query(
      `INSERT INTO activity_logs (user_id,action,entity_type,entity_id,metadata)
       VALUES ($1,'PROJECT_MEMBER_REMOVED','PROJECT',$2,$3::jsonb)`,
      [account.id,project.id,JSON.stringify({ memberUserId })],
    )
    return { projectId: project.legacy_mongo_id || project.id, removedUserId: memberUserId }
  })
}
