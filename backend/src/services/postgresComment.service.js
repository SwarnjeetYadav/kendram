import { ApiError } from '../utils/apiError.js'
import { resolvePostgresProjectAccess } from './postgresTaskMapping.service.js'

async function resolveTask(client, taskId, userId, role) {
  const value = String(taskId ?? '')
  if (!/^(?:[a-f\d]{24}|[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12})$/i.test(value)) {
    throw new ApiError(400, 'Invalid task id')
  }
  const taskResult = await client.query(
    `SELECT t.id,t.legacy_mongo_id,t.board_id,t.title,
            b.project_id,p.legacy_mongo_id AS project_legacy_mongo_id
       FROM tasks t
       JOIN boards b ON b.id=t.board_id
       JOIN projects p ON p.id=b.project_id
       JOIN board_columns c ON c.id=t.column_id
       WHERE t.legacy_mongo_id=$1 OR t.id::text=$1
       LIMIT 1`,
    [value],
  )
  const task = taskResult.rows[0]
  if (!task) throw new ApiError(404, 'Task not found in PostgreSQL')
  const access = await resolvePostgresProjectAccess(client, {
    projectId: task.project_legacy_mongo_id,
    userId,
    role,
  })
  return { task, access }
}

const commentSelect = `
  SELECT c.id,c.legacy_mongo_id,c.task_id,c.author_id,c.body,c.created_at,c.updated_at,
         u.legacy_mongo_id AS author_legacy_mongo_id,u.name AS author_name,
         u.email AS author_email,u.role AS author_role
    FROM comments c JOIN users u ON u.id=c.author_id
`

function toComment(row) {
  return {
    _id: row.legacy_mongo_id || row.id,
    id: row.id,
    taskId: row.task_legacy_mongo_id || row.task_id,
    userId: {
      _id: row.author_legacy_mongo_id || row.author_id,
      id: row.author_id,
      name: row.author_name,
      email: row.author_email,
      role: row.author_role,
    },
    message: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listPostgresComments({ pool, taskId, userId, role }) {
  const client = await pool.connect()
  try {
    const { task } = await resolveTask(client, taskId, userId, role)
    const result = await client.query(
      `${commentSelect}
       LEFT JOIN tasks t ON t.id=c.task_id
       WHERE c.task_id=$1
       ORDER BY c.created_at ASC,c.id ASC`,
      [task.id],
    )
    return result.rows.map((row) => toComment({ ...row, task_legacy_mongo_id: task.legacy_mongo_id }))
  } finally {
    client.release()
  }
}

export async function addPostgresComment({ pool, taskId, userId, role, message }) {
  const cleanMessage = typeof message === 'string' ? message.trim() : ''
  if (!cleanMessage) throw new ApiError(400, 'Comment message is required')
  if (cleanMessage.length > 2000) throw new ApiError(400, 'Comment is too long')

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { task, access } = await resolveTask(client, taskId, userId, role)
    const inserted = await client.query(
      `INSERT INTO comments (task_id,author_id,body)
       VALUES ($1,$2,$3)
       RETURNING id`,
      [task.id, access.user.id, cleanMessage],
    )
    await client.query(
      `INSERT INTO activity_logs (user_id,action,entity_type,entity_id,metadata)
       VALUES ($1,'COMMENT_ADDED','TASK',$2,$3::jsonb)`,
      [access.user.id, task.id, JSON.stringify({ commentId: inserted.rows[0].id })],
    )
    const result = await client.query(
      `${commentSelect}
       LEFT JOIN tasks t ON t.id=c.task_id
       WHERE c.id=$1`,
      [inserted.rows[0].id],
    )
    await client.query('COMMIT')
    return toComment({ ...result.rows[0], task_legacy_mongo_id: task.legacy_mongo_id })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
