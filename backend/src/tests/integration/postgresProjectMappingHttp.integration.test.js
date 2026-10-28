import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { getPostgresPool, closePostgresPool } from '../../db/postgres.js'

process.env.POSTGRES_PROJECTS_ENABLED = 'true'

const [{ default: app }, { default: User }] = await Promise.all([
  import('../../app.js'),
  import('../../models/User.js'),
])

let mongo
let ownerToken
let viewerToken
let adminToken
let ownerEmail
let viewerEmail
let adminEmail
let ownerMongoId
let projectLegacyId
let projectSqlId
let suffix

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for PostgreSQL project mapping HTTP tests')
  const migration = spawnSync(process.execPath, ['src/scripts/migratePostgres.js'], {
    cwd: process.cwd(), env: process.env, encoding: 'utf8',
  })
  if (migration.status !== 0) throw new Error(`PostgreSQL migration failed:\n${migration.stdout}\n${migration.stderr}`)

  mongo = await MongoMemoryServer.create()
  await mongoose.connect(mongo.getUri())
  suffix = randomUUID()
  ownerEmail = `pg-map-owner-${suffix}@example.test`
  viewerEmail = `pg-map-viewer-${suffix}@example.test`
  adminEmail = `pg-map-admin-${suffix}@example.test`
  const passwordHash = await bcrypt.hash('Password123!', 10)
  const [owner, viewer, admin] = await User.create([
    { name: 'Mapping Test Owner', email: ownerEmail, passwordHash, role: 'PROJECT_MANAGER', status: 'ACTIVE' },
    { name: 'Mapping Test Non-member', email: viewerEmail, passwordHash, role: 'TEAM_MEMBER', status: 'ACTIVE' },
    { name: 'Mapping Test Administrator', email: adminEmail, passwordHash, role: 'ADMINISTRATOR', status: 'ACTIVE' },
  ])
  ownerMongoId = String(owner._id)

  const [ownerLogin, viewerLogin, adminLogin] = await Promise.all([
    request(app).post('/api/v1/auth/login').send({ email: ownerEmail, password: 'Password123!' }),
    request(app).post('/api/v1/auth/login').send({ email: viewerEmail, password: 'Password123!' }),
    request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: 'Password123!' }),
  ])
  expect(ownerLogin.status).toBe(200)
  expect(viewerLogin.status).toBe(200)
  expect(adminLogin.status).toBe(200)
  ownerToken = ownerLogin.body.data.token
  viewerToken = viewerLogin.body.data.token
  adminToken = adminLogin.body.data.token

  projectLegacyId = randomUUID().replaceAll('-', '').slice(0, 24)
  const pool = getPostgresPool()
  const sqlOwner = await pool.query(
    `INSERT INTO users (name,email,password_hash,status,role,legacy_mongo_id)
     VALUES ($1,$2,$3,'ACTIVE','PROJECT_MANAGER',$4) RETURNING id`,
    ['Mapping Test Owner', `sql-${suffix}@example.test`, 'test-only-hash', ownerMongoId],
  )
  const sqlProject = await pool.query(
    `INSERT INTO projects (name,description,owner_id,status,legacy_mongo_id)
     VALUES ($1,$2,$3,'ACTIVE',$4) RETURNING id`,
    ['Project mapping fixture', 'Temporary HTTP integration fixture', sqlOwner.rows[0].id, projectLegacyId],
  )
  projectSqlId = sqlProject.rows[0].id
})

afterAll(async () => {
  try {
    const pool = process.env.DATABASE_URL ? getPostgresPool() : null
    if (pool && projectSqlId) await pool.query('DELETE FROM projects WHERE id=$1', [projectSqlId])
    if (pool) {
      const emails = [
        `sql-${suffix || ''}@example.test`,
        ownerEmail,
        viewerEmail,
        adminEmail,
      ].filter(Boolean)
      await pool.query(
        'DELETE FROM activity_logs WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))',
        [emails],
      )
      await pool.query('DELETE FROM users WHERE email = ANY($1::text[])', [emails])
    }
  } finally {
    await closePostgresPool()
    await mongoose.disconnect()
    await mongo?.stop()
  }
})

describe('PostgreSQL project mapping and authorization parity', () => {
  it('rejects malformed project IDs and reports valid but unmapped legacy IDs', async () => {
    const malformed = await request(app).get('/api/v1/postgres/projects/not-a-project')
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(malformed.status).toBe(400)
    expect(malformed.body.message).toContain('Invalid project id')

    const unmappedLegacyId = '0123456789abcdef01234567'
    const missing = await request(app).get(`/api/v1/postgres/projects/${unmappedLegacyId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(missing.status).toBe(404)
    expect(missing.body.message).toContain('Project not found')
  })

  it('allows the owner and administrator but denies a non-member, matching MongoDB project access rules', async () => {
    const owner = await request(app).get(`/api/v1/postgres/projects/${projectLegacyId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(owner.status).toBe(200)
    expect(owner.body.data._id).toBe(projectLegacyId)

    const nonMember = await request(app).get(`/api/v1/postgres/projects/${projectLegacyId}`)
      .set('Authorization', `Bearer ${viewerToken}`)
    expect(nonMember.status).toBe(403)
    expect(nonMember.body.message).toContain('not a member')

    const administrator = await request(app).get(`/api/v1/postgres/projects/${projectLegacyId}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(administrator.status).toBe(200)
    expect(administrator.body.data._id).toBe(projectLegacyId)
  })
})
