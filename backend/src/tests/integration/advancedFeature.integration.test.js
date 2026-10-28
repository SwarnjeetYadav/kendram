import { beforeAll, afterAll, afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import app from '../../app.js'
import User from '../../models/User.js'
import Project from '../../models/Project.js'
import ProjectMember from '../../models/ProjectMember.js'
import Task from '../../models/Task.js'
import TaskDependency from '../../models/TaskDependency.js'
import Invitation from '../../models/Invitation.js'

let mongoServer

async function createUser({ name, email, role = 'TEAM_MEMBER' }) {
  return User.create({
    name,
    email,
    passwordHash: await bcrypt.hash('Password123!', 10),
    role,
    status: 'ACTIVE',
  })
}

async function login(email) {
  const response = await request(app).post('/api/v1/auth/login').send({
    email,
    password: 'Password123!',
  })
  expect(response.status).toBe(200)
  return response.body.data.token
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create()
  await mongoose.connect(mongoServer.getUri())
})

afterEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Project.deleteMany({}),
    ProjectMember.deleteMany({}),
    Task.deleteMany({}),
    TaskDependency.deleteMany({}),
    Invitation.deleteMany({}),
  ])
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongoServer.stop()
})

describe('Anvaya advanced execution features', () => {
  it('ranks smart assignment candidates and exposes analytics plus insights', async () => {
    const owner = await createUser({ name: 'Owner', email: 'owner@advanced.test', role: 'PROJECT_MANAGER' })
    const memberA = await createUser({ name: 'Member A', email: 'a@advanced.test' })
    const memberB = await createUser({ name: 'Member B', email: 'b@advanced.test' })

    const ownerToken = await login(owner.email)
    const project = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ name: 'Advanced Project', status: 'ACTIVE' })

    const projectId = project.body.data._id
    await request(app).post('/api/v1/projects/' + projectId + '/members').set('Authorization', 'Bearer ' + ownerToken).send({ userId: memberA._id, projectRole: 'MEMBER' })
    await request(app).post('/api/v1/projects/' + projectId + '/members').set('Authorization', 'Bearer ' + ownerToken).send({ userId: memberB._id, projectRole: 'MEMBER' })

    await request(app).post('/api/v1/tasks/project/' + projectId)
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ title: 'Existing work', assigneeId: memberA._id, priority: 'HIGH' })

    const suggestions = await request(app)
      .get('/api/v1/projects/' + projectId + '/assignment-suggestions')
      .query({ priority: 'HIGH', estimateMinutes: 120 })
      .set('Authorization', 'Bearer ' + ownerToken)

    expect(suggestions.status).toBe(200)
    expect(suggestions.body.data).toHaveLength(3)
    expect([String(owner._id), String(memberA._id), String(memberB._id)]).toContain(String(suggestions.body.data[0].userId))
    expect(suggestions.body.data[0].reason).toBeTruthy()

    const analytics = await request(app)
      .get('/api/v1/projects/' + projectId + '/analytics')
      .set('Authorization', 'Bearer ' + ownerToken)
    expect(analytics.status).toBe(200)
    expect(analytics.body.data.totalTasks).toBe(1)

    const insights = await request(app)
      .get('/api/v1/projects/' + projectId + '/insights')
      .set('Authorization', 'Bearer ' + ownerToken)
    expect(insights.status).toBe(200)
    expect(insights.body.data[0].type).toBe('PROJECT_HEALTH')
  })

  it('creates dependencies, prevents cycles, blocks false progress, and records activity', async () => {
    const owner = await createUser({ name: 'Owner', email: 'dependency-owner@advanced.test', role: 'PROJECT_MANAGER' })
    const token = await login(owner.email)
    const projectResponse = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', 'Bearer ' + token)
      .send({ name: 'Dependency Project', status: 'ACTIVE' })
    const projectId = projectResponse.body.data._id

    const a = await request(app).post('/api/v1/tasks/project/' + projectId).set('Authorization', 'Bearer ' + token).send({ title: 'API Integration' })
    const b = await request(app).post('/api/v1/tasks/project/' + projectId).set('Authorization', 'Bearer ' + token).send({ title: 'Frontend Integration' })
    const taskA = a.body.data._id
    const taskB = b.body.data._id

    const dependency = await request(app)
      .post('/api/v1/tasks/' + taskB + '/dependencies')
      .set('Authorization', 'Bearer ' + token)
      .send({ predecessorTaskId: taskA })
    expect(dependency.status).toBe(201)

    const blockedUpdate = await request(app)
      .patch('/api/v1/tasks/' + taskB)
      .set('Authorization', 'Bearer ' + token)
      .send({ status: 'COMPLETED' })
    expect(blockedUpdate.status).toBe(409)

    const cycle = await request(app)
      .post('/api/v1/tasks/' + taskA + '/dependencies')
      .set('Authorization', 'Bearer ' + token)
      .send({ predecessorTaskId: taskB })
    expect(cycle.status).toBe(422)

    const activity = await request(app)
      .get('/api/v1/tasks/' + taskB + '/activity')
      .set('Authorization', 'Bearer ' + token)
    expect(activity.status).toBe(200)
    expect(activity.body.data.some((event) => event.action === 'TASK_DEPENDENCY_ADDED')).toBe(true)
  })

  it('supports project invitations and permission-aware search', async () => {
    const owner = await createUser({ name: 'Owner', email: 'invite-owner@advanced.test', role: 'PROJECT_MANAGER' })
    const invitee = await createUser({ name: 'Invitee', email: 'invitee@advanced.test' })
    const outsider = await createUser({ name: 'Outsider', email: 'outsider@advanced.test' })

    const ownerToken = await login(owner.email)
    const projectResponse = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ name: 'Invite Project', status: 'ACTIVE' })
    const projectId = projectResponse.body.data._id

    const invite = await request(app)
      .post('/api/v1/projects/' + projectId + '/invitations')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ invitedUserId: invitee._id, projectRole: 'MEMBER' })
    expect(invite.status).toBe(201)

    const inviteeToken = await login(invitee.email)
    const pending = await request(app).get('/api/v1/invitations').set('Authorization', 'Bearer ' + inviteeToken)
    expect(pending.status).toBe(200)
    expect(pending.body.data).toHaveLength(1)

    const accept = await request(app)
      .patch('/api/v1/invitations/' + pending.body.data[0]._id)
      .set('Authorization', 'Bearer ' + inviteeToken)
      .send({ action: 'ACCEPT' })
    expect(accept.status).toBe(200)

    const outsiderToken = await login(outsider.email)
    const search = await request(app)
      .get('/api/v1/search')
      .query({ q: 'Invite' })
      .set('Authorization', 'Bearer ' + outsiderToken)
    expect(search.status).toBe(200)
    expect(search.body.data.projects).toHaveLength(0)
  })
})
