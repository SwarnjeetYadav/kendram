import { ApiError } from '../utils/apiError.js'
import { validateLegacyMongoId } from './postgresTaskMapping.service.js'

async function resolveAccount(client, legacyUserId) {
  const id = validateLegacyMongoId(legacyUserId, 'user id')
  const result = await client.query(
    "SELECT id FROM users WHERE legacy_mongo_id=$1 AND status='ACTIVE'",
    [id],
  )
  if (!result.rows[0]) throw new ApiError(403, 'Your account is not mapped to PostgreSQL')
  return result.rows[0]
}

function dto(row) {
  return {
    _id: row.id,
    id: row.id,
    userId: row.legacy_mongo_id || row.user_id,
    type: row.type,
    message: row.message,
    entityId: row.entity_id,
    readAt: row.read_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listPostgresNotifications({ pool, userId }) {
  const client = await pool.connect()
  try {
    const account = await resolveAccount(client, userId)
    const result = await client.query(
      `SELECT n.*,u.legacy_mongo_id FROM notifications n
       JOIN users u ON u.id=n.user_id
       WHERE n.user_id=$1 ORDER BY n.created_at DESC,n.id DESC LIMIT 50`,
      [account.id],
    )
    return result.rows.map(dto)
  } finally { client.release() }
}

export async function markPostgresNotificationRead({ pool, userId, notificationId }) {
  if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(String(notificationId ?? ''))) {
    throw new ApiError(400, 'Invalid notification id')
  }
  const client = await pool.connect()
  try {
    const account = await resolveAccount(client, userId)
    const result = await client.query(
      `UPDATE notifications SET read_at=COALESCE(read_at,now()),updated_at=now()
       WHERE id::text=$1 AND user_id=$2
       RETURNING id,user_id,type,message,entity_id,read_at,created_at,updated_at`,
      [String(notificationId),account.id],
    )
    if (!result.rows[0]) throw new ApiError(404, 'Notification not found')
    const row=result.rows[0]
    return { _id:row.id,id:row.id,userId:userId,type:row.type,message:row.message,entityId:row.entity_id,readAt:row.read_at,createdAt:row.created_at,updatedAt:row.updated_at }
  } finally { client.release() }
}
