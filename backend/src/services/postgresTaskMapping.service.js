import { ApiError } from '../utils/apiError.js'

const STATUS_COLUMNS = {
  TODO: ['TODO', 'TO_DO'],
  IN_PROGRESS: ['IN_PROGRESS'],
  REVIEW: ['REVIEW'],
  BLOCKED: ['BLOCKED'],
  COMPLETED: ['COMPLETED', 'DONE'],
}

export function validateLegacyMongoId(value, field = 'id') {
  const id = String(value ?? '')
  if (!/^[a-f\d]{24}$/i.test(id)) throw new ApiError(400, `Invalid ${field}`)
  return id
}

export async function resolvePostgresProjectAccess(client, { projectId, userId, role }) {
  const legacyProjectId = validateLegacyMongoId(projectId, 'project id')
  const legacyUserId = validateLegacyMongoId(userId, 'user id')
  // A checked-out pg Client must not execute concurrent queries. Keep these
  // lookups sequential on the same transaction/client to avoid pg deprecation
  // warnings and preserve predictable query ordering.
  const projectResult = await client.query(
    'SELECT id, legacy_mongo_id, owner_id FROM projects WHERE legacy_mongo_id = $1',
    [legacyProjectId],
  )
  const userResult = await client.query(
    "SELECT id, legacy_mongo_id FROM users WHERE legacy_mongo_id = $1 AND status = 'ACTIVE'",
    [legacyUserId],
  )
  const project = projectResult.rows[0]
  const user = userResult.rows[0]
  if (!project) throw new ApiError(404, 'Project is not migrated to PostgreSQL')
  if (!user) throw new ApiError(403, 'Your account is not mapped to PostgreSQL')

  let membership = null
  if (role !== 'ADMINISTRATOR' && project.owner_id !== user.id) {
    const result = await client.query(
      'SELECT project_role FROM project_members WHERE project_id = $1 AND user_id = $2',
      [project.id, user.id],
    )
    membership = result.rows[0] || null
    if (!membership) throw new ApiError(403, 'You are not a member of this project')
  }
  return { project, user, membership }
}

export async function resolvePostgresBoardColumn(client, projectId, status) {
  const names = STATUS_COLUMNS[status]
  if (!names) throw new ApiError(400, 'Invalid task status')
  const board = await client.query(
    'SELECT id FROM boards WHERE project_id = $1 ORDER BY created_at, id LIMIT 1',
    [projectId],
  )
  if (!board.rows[0]) throw new ApiError(409, 'This project has no migrated PostgreSQL board')
  const column = await client.query(
    `SELECT id FROM board_columns
      WHERE board_id = $1 AND upper(replace(name, ' ', '_')) = ANY($2::text[])
      ORDER BY position LIMIT 1`,
    [board.rows[0].id, names],
  )
  if (!column.rows[0]) throw new ApiError(409, `The PostgreSQL board is missing a column for status ${status}`)
  return { boardId: board.rows[0].id, columnId: column.rows[0].id }
}

export function getPostgresStatusColumnNames() {
  return Object.keys(STATUS_COLUMNS)
}
