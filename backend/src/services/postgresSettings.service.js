import { ApiError } from '../utils/apiError.js'
import { validateLegacyMongoId } from './postgresTaskMapping.service.js'

const DEFAULTS = {
  notifications: { taskAssignment:true, projectInvitation:true, chatMention:true, dependencyUnblocked:true, teamUpdates:true },
  display: { compactMode:false },
}

function merge(current = {}, patch = {}) {
  return {
    notifications: { ...DEFAULTS.notifications, ...(current.notifications || {}), ...(patch.notifications || {}) },
    display: { ...DEFAULTS.display, ...(current.display || {}), ...(patch.display || {}) },
  }
}

function validatePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new ApiError(400,'Invalid preferences payload')
  for (const section of ['notifications','display']) {
    if (patch[section] !== undefined && (!patch[section] || typeof patch[section] !== 'object' || Array.isArray(patch[section]))) {
      throw new ApiError(400,`Invalid ${section} preferences`)
    }
  }
  for (const [key,value] of Object.entries(patch.notifications || {})) {
    if (!Object.hasOwn(DEFAULTS.notifications,key) || typeof value !== 'boolean') throw new ApiError(400,`Invalid notification preference: ${key}`)
  }
  for (const [key,value] of Object.entries(patch.display || {})) {
    if (!Object.hasOwn(DEFAULTS.display,key) || typeof value !== 'boolean') throw new ApiError(400,`Invalid display preference: ${key}`)
  }
}

async function resolveAccount(client,userId) {
  const legacyId=validateLegacyMongoId(userId,'user id')
  const result=await client.query("SELECT id,preferences FROM users WHERE legacy_mongo_id=$1 AND status='ACTIVE'",[legacyId])
  if(!result.rows[0]) throw new ApiError(403,'Your account is not mapped to PostgreSQL')
  return result.rows[0]
}

export async function getPostgresPreferences({pool,userId}) {
  const client=await pool.connect()
  try {
    const account=await resolveAccount(client,userId)
    return merge(account.preferences || {})
  } finally { client.release() }
}

export async function updatePostgresPreferences({pool,userId,patch}) {
  validatePatch(patch)
  const client=await pool.connect()
  try {
    await client.query('BEGIN')
    const account=await resolveAccount(client,userId)
    const preferences=merge(account.preferences || {},patch)
    await client.query('UPDATE users SET preferences=$1::jsonb,updated_at=now() WHERE id=$2',[JSON.stringify(preferences),account.id])
    await client.query('COMMIT')
    return preferences
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>{})
    throw error
  } finally { client.release() }
}
