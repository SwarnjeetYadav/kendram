import { beforeAll, afterAll, afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import app from '../../app.js'
import User from '../../models/User.js'
import ProjectMember from '../../models/ProjectMember.js'
import Project from '../../models/Project.js'
import Task from '../../models/Task.js'
import Notification from '../../models/Notification.js'
import ProjectMessage from '../../models/ProjectMessage.js'

let mongoServer

async function createUser({ name, email, role = 'TEAM_MEMBER' }) {
  const passwordHash = await bcrypt.hash('Password123!', 10)
  return User.create({ name, email, passwordHash, role, status: 'ACTIVE' })
}

async function login(email) {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: 'Password123!' })

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
    Notification.deleteMany({}),
    ProjectMessage.deleteMany({}),
  ])
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongoServer.stop()
})

describe('Anvaya team management and project chat', () => {
  it('adds members with project roles, updates permissions, and removes members safely', async () => {
    const owner = await createUser({ name: 'Owner', email: 'owner@anvaya.test', role: 'PROJECT_MANAGER' })
    const manager = await createUser({ name: 'Team Manager', email: 'manager@anvaya.test' })
    const member = await createUser({ name: 'Contributor', email: 'member@anvaya.test' })
    const viewer = await createUser({ name: 'Viewer', email: 'viewer@anvaya.test' })

    const ownerToken = await login(owner.email)
    const projectResponse = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ name: 'Anvaya Team Project', status: 'ACTIVE' })

    expect(projectResponse.status).toBe(201)
    const projectId = projectResponse.body.data._id

    const managerAdd = await request(app)
      .post('/api/v1/projects/' + projectId + '/members')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ userId: manager._id, projectRole: 'PROJECT_MANAGER' })

    const memberAdd = await request(app)
      .post('/api/v1/projects/' + projectId + '/members')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ userId: member._id, projectRole: 'MEMBER' })

    const viewerAdd = await request(app)
      .post('/api/v1/projects/' + projectId + '/members')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ userId: viewer._id, projectRole: 'VIEWER' })

    expect(managerAdd.status).toBe(201)
    expect(managerAdd.body.data.projectRole).toBe('PROJECT_MANAGER')
    expect(memberAdd.status).toBe(201)
    expect(viewerAdd.status).toBe(201)

    const managerToken = await login(manager.email)

    const promoteMember = await request(app)
      .patch('/api/v1/projects/' + projectId + '/members/' + member._id)
      .set('Authorization', 'Bearer ' + managerToken)
      .send({ projectRole: 'VIEWER' })

    expect(promoteMember.status).toBe(200)
    expect(promoteMember.body.data.projectRole).toBe('VIEWER')

    const removeMember = await request(app)
      .delete('/api/v1/projects/' + projectId + '/members/' + member._id)
      .set('Authorization', 'Bearer ' + managerToken)

    expect(removeMember.status).toBe(200)
    expect(String(removeMember.body.data.removedUserId)).toBe(String(member._id))

    const ownerRemoval = await request(app)
      .delete('/api/v1/projects/' + projectId + '/members/' + owner._id)
      .set('Authorization', 'Bearer ' + ownerToken)

    expect(ownerRemoval.status).toBe(400)

    const remaining = await ProjectMember.find({ projectId }).lean()
    expect(remaining).toHaveLength(3)
  })

  it('keeps viewers read-only and excludes them from smart assignment', async () => {
    const owner = await createUser({ name: 'Owner', email: 'owner2@anvaya.test', role: 'PROJECT_MANAGER' })
    const contributor = await createUser({ name: 'Contributor', email: 'contributor2@anvaya.test' })
    const viewer = await createUser({ name: 'Viewer', email: 'viewer2@anvaya.test' })

    const token = await login(owner.email)
    const projectResponse = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', 'Bearer ' + token)
      .send({ name: 'Permission Project', status: 'ACTIVE' })

    const projectId = projectResponse.body.data._id

    await request(app)
      .post('/api/v1/projects/' + projectId + '/members')
      .set('Authorization', 'Bearer ' + token)
      .send({ userId: contributor._id, projectRole: 'MEMBER' })

    await request(app)
      .post('/api/v1/projects/' + projectId + '/members')
      .set('Authorization', 'Bearer ' + token)
      .send({ userId: viewer._id, projectRole: 'VIEWER' })

    const viewerToken = await login(viewer.email)
    const viewerCreate = await request(app)
      .post('/api/v1/tasks/project/' + projectId)
      .set('Authorization', 'Bearer ' + viewerToken)
      .send({ title: 'Viewer should not create tasks' })

    expect(viewerCreate.status).toBe(403)

    const explicitViewerAssignment = await request(app)
      .post('/api/v1/tasks/project/' + projectId)
      .set('Authorization', 'Bearer ' + token)
      .send({ title: 'Cannot assign to viewer', assigneeId: viewer._id })

    expect(explicitViewerAssignment.status).toBe(422)

    const smartTask = await request(app)
      .post('/api/v1/tasks/project/' + projectId)
      .set('Authorization', 'Bearer ' + token)
      .send({ title: 'Smart contributor assignment' })

    expect(smartTask.status).toBe(201)
    expect([String(owner._id), String(contributor._id)]).toContain(String(smartTask.body.data.assigneeId))
    expect(String(smartTask.body.data.assigneeId)).not.toBe(String(viewer._id))
  })

  it('allows project managers to use team management and project chat', async () => {
    const owner = await createUser({ name: 'Owner', email: 'owner3@anvaya.test', role: 'PROJECT_MANAGER' })
    const manager = await createUser({ name: 'Project Manager', email: 'pm@anvaya.test' })
    const teammate = await createUser({ name: 'Teammate', email: 'teammate@anvaya.test' })

    const ownerToken = await login(owner.email)
    const projectResponse = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ name: 'Chat Project', status: 'ACTIVE' })

    const projectId = projectResponse.body.data._id

    await request(app)
      .post('/api/v1/projects/' + projectId + '/members')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ userId: manager._id, projectRole: 'PROJECT_MANAGER' })

    const managerToken = await login(manager.email)

    const addFromManager = await request(app)
      .post('/api/v1/projects/' + projectId + '/members')
      .set('Authorization', 'Bearer ' + managerToken)
      .send({ userId: teammate._id, projectRole: 'MEMBER' })

    expect(addFromManager.status).toBe(201)

    const sendChat = await request(app)
      .post('/api/v1/projects/' + projectId + '/chat')
      .set('Authorization', 'Bearer ' + managerToken)
      .send({ message: 'Sprint planning at 10 AM.' })

    expect(sendChat.status).toBe(201)
    expect(sendChat.body.data.message).toBe('Sprint planning at 10 AM.')

    const readChat = await request(app)
      .get('/api/v1/projects/' + projectId + '/chat')
      .set('Authorization', 'Bearer ' + managerToken)

    expect(readChat.status).toBe(200)
    expect(readChat.body.data).toHaveLength(1)
    expect(readChat.body.data[0].userId.email).toBe(manager.email)
  })
})
