import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { getPostgresPool, closePostgresPool } from '../../db/postgres.js'

process.env.POSTGRES_AUTH_ENABLED = 'true'
const [{ default: app }] = await Promise.all([import('../../app.js')])
const hash = value => createHash('sha256').update(value).digest('hex')
let email, password, userId, legacyId, token, verifyToken, resetToken

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for PostgreSQL auth HTTP integration tests')
  const migration = spawnSync(process.execPath, ['src/scripts/migratePostgres.js'], { cwd: process.cwd(), env: process.env, encoding: 'utf8' })
  if (migration.status !== 0) throw new Error('PostgreSQL migration failed:\n' + migration.stdout + '\n' + migration.stderr)
  const pool = getPostgresPool()
  const suffix = randomBytes(8).toString('hex')
  email = 'pg-auth-' + suffix + '@example.test'
  password = 'Password123!'
  legacyId = randomBytes(12).toString('hex')
  verifyToken = 'verify-' + suffix
  resetToken = 'reset-' + suffix
  const inserted = await pool.query(
    "INSERT INTO users(name,email,password_hash,role,status,email_verified,legacy_mongo_id,email_verification_token_hash,email_verification_expires_at,password_reset_token_hash,password_reset_expires_at) VALUES($1,$2,$3,'TEAM_MEMBER','ACTIVE',false,$4,$5,now()+interval '30 minutes',$6,now()+interval '30 minutes') RETURNING id",
    ['PostgreSQL Auth Test',email,await bcrypt.hash(password,10),legacyId,hash(verifyToken),hash(resetToken)],
  )
  userId = inserted.rows[0].id
})

afterAll(async () => {
  try {
    if (process.env.DATABASE_URL && email) {
      const pool = getPostgresPool()
      await pool.query('DELETE FROM activity_logs WHERE user_id IN (SELECT id FROM users WHERE email=$1)', [email])
      await pool.query('DELETE FROM users WHERE email=$1', [email])
    }
  } finally { await closePostgresPool() }
})

describe('PostgreSQL auth HTTP flow behind opt-in flag', () => {
  it('rejects unverified login, verifies email, and then logs in', async () => {
    const blocked = await request(app).post('/api/v1/auth/login').send({ email, password })
    expect(blocked.status).toBe(403)
    const verified = await request(app).post('/api/v1/auth/verify-email').send({ token: verifyToken })
    expect(verified.status).toBe(200)
    expect(verified.body.data.verified).toBe(true)
    const login = await request(app).post('/api/v1/auth/login').send({ email, password })
    expect(login.status).toBe(200)
    expect(login.body.data.user.id).toBe(legacyId)
    token = login.body.data.token
  })

  it('validates PostgreSQL access tokens and persists profile changes', async () => {
    const me = await request(app).get('/api/v1/auth/me').set('Authorization','Bearer '+token)
    expect(me.status).toBe(200)
    expect(me.body.data.id).toBe(legacyId)
    const profile = await request(app).patch('/api/v1/auth/profile').set('Authorization','Bearer '+token).send({ displayName:'PG Auth', bio:'Profile persisted' })
    expect(profile.status).toBe(200)
    expect(profile.body.data.displayName).toBe('PG Auth')
    expect(profile.body.data.bio).toBe('Profile persisted')
    const pool = getPostgresPool()
    const stored = await pool.query('SELECT display_name,bio FROM users WHERE id=$1',[userId])
    expect(stored.rows[0]).toMatchObject({ display_name:'PG Auth', bio:'Profile persisted' })
  })

  it('rejects expired email verification tokens and does not activate the account', async () => {
    const suffix = randomBytes(8).toString('hex')
    const expiredRaw = 'expired-verify-' + suffix
    const expiredEmail = 'pg-expired-verify-' + suffix + '@example.test'
    const pool = getPostgresPool()
    const inserted = await pool.query(
      "INSERT INTO users(name,email,password_hash,role,status,email_verified,legacy_mongo_id,email_verification_token_hash,email_verification_expires_at) VALUES($1,$2,$3,'TEAM_MEMBER','ACTIVE',false,$4,$5,now()-interval '1 minute') RETURNING id",
      ['Expired Verification Test', expiredEmail, await bcrypt.hash('Password123!', 10), randomBytes(12).toString('hex'), hash(expiredRaw)],
    )
    try {
      const expired = await request(app).post('/api/v1/auth/verify-email').send({ token: expiredRaw })
      expect(expired.status).toBe(400)
      const stored = await pool.query('SELECT email_verified FROM users WHERE id=$1', [inserted.rows[0].id])
      expect(stored.rows[0].email_verified).toBe(false)
    } finally {
      await pool.query('DELETE FROM users WHERE id=$1', [inserted.rows[0].id])
    }
  })

  it('resets the password once and invalidates the reset token', async () => {
    const reset = await request(app).post('/api/v1/auth/reset-password').send({ token: resetToken, password:'ChangedPassword123!' })
    expect(reset.status).toBe(200)
    const replay = await request(app).post('/api/v1/auth/reset-password').send({ token: resetToken, password:'ChangedPassword123!' })
    expect(replay.status).toBe(400)
    const login = await request(app).post('/api/v1/auth/login').send({ email, password:'ChangedPassword123!' })
    expect(login.status).toBe(200)
  })

  it('rejects invalid or expired bearer tokens', async () => {
    const response = await request(app).get('/api/v1/auth/me').set('Authorization','Bearer invalid-token')
    expect(response.status).toBe(401)
  })
})
