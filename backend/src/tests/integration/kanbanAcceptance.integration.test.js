import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import app from '../../app.js'
import User from '../../models/User.js'
import Project from '../../models/Project.js'
import ProjectMember from '../../models/ProjectMember.js'
import Task from '../../models/Task.js'
import Comment from '../../models/Comment.js'
import ActivityLog from '../../models/ActivityLog.js'
import Notification from '../../models/Notification.js'
import TaskDependency from '../../models/TaskDependency.js'

let mongo
let token
let projectId

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  await mongoose.connect(mongo.getUri())
  const passwordHash = await bcrypt.hash('Password123!', 10)
  const user = await User.create({ name: 'Kanban Test User', email: 'kanban-test@example.test', passwordHash, role: 'PROJECT_MANAGER', status: 'ACTIVE' })
  const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Password123!' })
  token = login.body.data.token
  const project = await Project.create({ name: 'Kanban acceptance project', description: 'Test project', ownerId: user._id, status: 'ACTIVE' })
  projectId = String(project._id)
})

afterEach(async () => {
  await Promise.all([Task.deleteMany({}), Comment.deleteMany({}), ActivityLog.deleteMany({}), Notification.deleteMany({}), TaskDependency.deleteMany({}), ProjectMember.deleteMany({})])
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongo.stop()
})

describe('Kanban brief acceptance: task filters, pagination and concurrency', () => {
  it('creates labeled tasks and returns bounded pagination metadata', async () => {
    const create = async (title, labels, dueDate) => request(app)
      .post('/api/v1/tasks/project/' + projectId)
      .set('Authorization', 'Bearer ' + token)
      .send({ title, labels, dueDate, priority: 'HIGH' })
    expect((await create('API filter test', ['backend', 'urgent'], '2026-11-01T10:00:00.000Z')).status).toBe(201)
    expect((await create('UI filter test', ['frontend'], '2026-11-05T10:00:00.000Z')).status).toBe(201)

    const page = await request(app).get('/api/v1/tasks/project/' + projectId + '?page=1&limit=1')
      .set('Authorization', 'Bearer ' + token)
    expect(page.status).toBe(200)
    expect(page.body.data).toHaveLength(1)
    expect(page.body.meta.pagination).toMatchObject({ page: 1, limit: 1, total: 2, pages: 2, hasNextPage: true })

    const label = await request(app).get('/api/v1/tasks/project/' + projectId + '?label=backend')
      .set('Authorization', 'Bearer ' + token)
    expect(label.status).toBe(200)
    expect(label.body.data).toHaveLength(1)
    expect(label.body.data[0].labels).toContain('backend')

    const invalid = await request(app).get('/api/v1/tasks/project/' + projectId + '?page=0')
      .set('Authorization', 'Bearer ' + token)
    expect(invalid.status).toBe(400)
  })

  it('rejects a stale task version and increments the version on a successful update', async () => {
    const created = await request(app).post('/api/v1/tasks/project/' + projectId)
      .set('Authorization', 'Bearer ' + token).send({ title: 'Concurrent move', labels: ['kanban'] })
    expect(created.status).toBe(201)
    const taskId = created.body.data._id
    const version = created.body.data.version || 1

    const first = await request(app).patch('/api/v1/tasks/' + taskId)
      .set('Authorization', 'Bearer ' + token).send({ status: 'IN_PROGRESS', version })
    expect(first.status).toBe(200)
    expect(first.body.data.version).toBe(version + 1)

    const stale = await request(app).patch('/api/v1/tasks/' + taskId)
      .set('Authorization', 'Bearer ' + token).send({ status: 'REVIEW', version })
    expect(stale.status).toBe(409)
    expect(stale.body.success).toBe(false)
  })

  it('rejects malformed label payloads and invalid filter values', async () => {
    const invalidCreate = await request(app).post('/api/v1/tasks/project/' + projectId)
      .set('Authorization', 'Bearer ' + token).send({ title: 'Bad labels', labels: 'not-an-array' })
    expect(invalidCreate.status).toBe(400)
    const invalidFilter = await request(app).get('/api/v1/tasks/project/' + projectId + '?limit=1000')
      .set('Authorization', 'Bearer ' + token)
    expect(invalidFilter.status).toBe(400)
  })
})
