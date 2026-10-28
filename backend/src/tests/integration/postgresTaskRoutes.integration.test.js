import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

// This suite verifies the safe default: PostgreSQL routes are not mounted unless
// explicitly enabled. Use a fresh app import after setting the flag.
process.env.POSTGRES_TASKS_ENABLED = 'false'

const [{ default: app }, { default: User }, { default: Project }] = await Promise.all([
  import('../../app.js'),
  import('../../models/User.js'),
  import('../../models/Project.js'),
])

let mongo
let token
let projectId

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  await mongoose.connect(mongo.getUri())
  const passwordHash = await bcrypt.hash('Password123!', 10)
  const user = await User.create({
    name: 'Postgres Route Safety',
    email: 'postgres-route-safety@example.test',
    passwordHash,
    role: 'PROJECT_MANAGER',
    status: 'ACTIVE',
  })
  const login = await request(app).post('/api/v1/auth/login')
    .send({ email: user.email, password: 'Password123!' })
  expect(login.status).toBe(200)
  token = login.body.data.token
  const project = await Project.create({
    name: 'Mongo default route project',
    description: 'Ensures existing task route stays active',
    ownerId: user._id,
    status: 'ACTIVE',
  })
  projectId = String(project._id)
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongo?.stop()
})

describe('PostgreSQL task route safety', () => {
  it('does not expose PostgreSQL task routes when the feature flag is false', async () => {
    const response = await request(app)
      .get('/api/v1/postgres/tasks/project/0123456789abcdef01234567')
    expect(response.status).toBe(404)
    expect(response.body.success).toBe(false)
  })

  it('keeps the existing MongoDB task API available by default', async () => {
    const response = await request(app)
      .post('/api/v1/tasks/project/' + projectId)
      .set('Authorization', 'Bearer ' + token)
      .send({ title: 'Mongo task route remains active' })
    expect(response.status).toBe(201)
    expect(response.body.success).toBe(true)
    expect(response.body.data.title).toBe('Mongo task route remains active')
  })

  it('still requires authentication for the existing task API', async () => {
    const response = await request(app)
      .get('/api/v1/tasks/project/' + projectId)
    expect(response.status).toBe(401)
  })
})
