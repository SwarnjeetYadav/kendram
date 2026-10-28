import { beforeAll, afterAll, afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import app from '../../app.js'

import User from '../../models/User.js'
import ProjectMember from '../../models/ProjectMember.js'
import Task from '../../models/Task.js'
import Comment from '../../models/Comment.js'
import ActivityLog from '../../models/ActivityLog.js'
import Notification from '../../models/Notification.js'

let mongoServer

async function createUser({ name, email, role = 'TEAM_MEMBER' }) {
  const passwordHash = await bcrypt.hash('Password123!', 10)
  return User.create({
    name,
    email,
    passwordHash,
    role,
    status: 'ACTIVE',
  })
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
    ProjectMember.deleteMany({}),
    Task.deleteMany({}),
    Comment.deleteMany({}),
    ActivityLog.deleteMany({}),
    Notification.deleteMany({}),
  ])
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongoServer.stop()
})

describe('TeamFlow API end to end workflow', () => {
  it('authenticates, creates a project, adds a member, creates a smart-assigned task, comments, and notifies', async () => {
    const manager = await createUser({
      name: 'Project Manager',
      email: 'manager@test.teamflow',
      role: 'PROJECT_MANAGER',
    })

    const teammate = await createUser({
      name: 'Team Member',
      email: 'member@test.teamflow',
      role: 'TEAM_MEMBER',
    })

    const candidate = await createUser({
      name: 'Search Candidate',
      email: 'candidate@test.teamflow',
      role: 'TEAM_MEMBER',
    })

    const token = await login(manager.email)

    const projectResponse = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', 'Bearer ' + token)
      .send({
        name: 'Integration Test Project',
        description: 'Full TeamFlow workflow test',
        status: 'ACTIVE',
      })

    expect(projectResponse.status).toBe(201)
    const projectId = projectResponse.body.data._id

    const memberResponse = await request(app)
      .post('/api/v1/projects/' + projectId + '/members')
      .set('Authorization', 'Bearer ' + token)
      .send({ userId: teammate._id })

    expect(memberResponse.status).toBe(201)

    const candidateResponse = await request(app)
      .get('/api/v1/projects/' + projectId + '/members/candidates')
      .query({ q: 'candidate' })
      .set('Authorization', 'Bearer ' + token)

    expect(candidateResponse.status).toBe(200)
    expect(candidateResponse.body.data).toHaveLength(1)
    expect(candidateResponse.body.data[0].email).toBe(candidate.email)

    const candidateAddResponse = await request(app)
      .post('/api/v1/projects/' + projectId + '/members')
      .set('Authorization', 'Bearer ' + token)
      .send({ userId: candidate._id })

    expect(candidateAddResponse.status).toBe(201)

    const membersResponse = await request(app)
      .get('/api/v1/projects/' + projectId + '/members')
      .set('Authorization', 'Bearer ' + token)

    expect(membersResponse.status).toBe(200)
    expect(membersResponse.body.data).toHaveLength(3)

    const duplicateMemberResponse = await request(app)
      .post('/api/v1/projects/' + projectId + '/members')
      .set('Authorization', 'Bearer ' + token)
      .send({ userId: teammate._id })

    expect(duplicateMemberResponse.status).toBe(409)

    // Give the manager one active task so smart assignment should prefer the teammate.
    const firstTaskResponse = await request(app)
      .post('/api/v1/tasks/project/' + projectId)
      .set('Authorization', 'Bearer ' + token)
      .send({
        title: 'Existing manager task',
        priority: 'MEDIUM',
        assigneeId: manager._id,
      })

    expect(firstTaskResponse.status).toBe(201)

    const smartTaskResponse = await request(app)
      .post('/api/v1/tasks/project/' + projectId)
      .set('Authorization', 'Bearer ' + token)
      .send({
        title: 'Smart assigned task',
        description: 'Created without an explicit assignee',
        priority: 'HIGH',
      })

    expect(smartTaskResponse.status).toBe(201)
    expect(String(smartTaskResponse.body.data.assigneeId)).toBe(String(teammate._id))

    const taskId = smartTaskResponse.body.data._id

    const commentResponse = await request(app)
      .post('/api/v1/comments/tasks/' + taskId + '/comments')
      .set('Authorization', 'Bearer ' + token)
      .send({ message: 'This task is ready for implementation.' })

    expect(commentResponse.status).toBe(201)
    expect(commentResponse.body.data.message).toBe('This task is ready for implementation.')

    const commentsResponse = await request(app)
      .get('/api/v1/comments/tasks/' + taskId + '/comments')
      .set('Authorization', 'Bearer ' + token)

    expect(commentsResponse.status).toBe(200)
    expect(commentsResponse.body.data).toHaveLength(1)

    const notificationsResponse = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', 'Bearer ' + token)

    expect(notificationsResponse.status).toBe(200)

    const teammateToken = await login(teammate.email)

    const teammateMembersResponse = await request(app)
      .get('/api/v1/projects/' + projectId + '/members')
      .set('Authorization', 'Bearer ' + teammateToken)

    expect(teammateMembersResponse.status).toBe(200)
    expect(teammateMembersResponse.body.data).toHaveLength(3)

    const teammateNotifications = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', 'Bearer ' + teammateToken)

    expect(teammateNotifications.status).toBe(200)
    expect(teammateNotifications.body.data.some((item) => item.type === 'TASK_ASSIGNED')).toBe(true)

    const activityResponse = await request(app)
      .get('/api/v1/activity')
      .set('Authorization', 'Bearer ' + token)

    expect(activityResponse.status).toBe(200)
    expect(activityResponse.body.data.map((item) => item.action))
      .toEqual(expect.arrayContaining(['TASK_CREATED', 'COMMENT_ADDED']))

    const persistedTask = await Task.findById(taskId).lean()
    const persistedComment = await Comment.findOne({ taskId }).lean()
    const persistedNotification = await Notification.findOne({ entityId: taskId }).lean()
    const persistedActivityCount = await ActivityLog.countDocuments({ entityId: taskId })

    expect(persistedTask).not.toBeNull()
    expect(persistedTask.assigneeId.toString()).toBe(teammate._id.toString())
    expect(persistedComment.message).toContain('ready for implementation')
    expect(persistedNotification.type).toBe('TASK_ASSIGNED')
    expect(persistedActivityCount).toBeGreaterThanOrEqual(2)
  })

  it('allows a newly registered team member to create and own a project', async () => {
    const user = await createUser({
      name: 'New Project Owner',
      email: 'newowner@test.teamflow',
      role: 'TEAM_MEMBER',
    })

    const token = await login(user.email)

    const response = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', 'Bearer ' + token)
      .send({
        name: 'My First TeamFlow Project',
        description: 'Created by a new account',
        status: 'PLANNING',
      })

    expect(response.status).toBe(201)
    expect(response.body.data.name).toBe('My First TeamFlow Project')
    expect(String(response.body.data.ownerId)).toBe(String(user._id))

    const projectsResponse = await request(app)
      .get('/api/v1/projects')
      .set('Authorization', 'Bearer ' + token)

    expect(projectsResponse.status).toBe(200)
    expect(projectsResponse.body.data).toHaveLength(1)
    expect(projectsResponse.body.data[0].name).toBe('My First TeamFlow Project')

    const taskResponse = await request(app)
      .post('/api/v1/tasks/project/' + response.body.data._id)
      .set('Authorization', 'Bearer ' + token)
      .send({
        title: 'My first task',
        priority: 'MEDIUM',
      })

    expect(taskResponse.status).toBe(201)
    expect(taskResponse.body.data.title).toBe('My first task')
    expect(String(taskResponse.body.data.createdBy)).toBe(String(user._id))
  })

  it('rejects access to a project for a non-member', async () => {
    const manager = await createUser({
      name: 'Owner',
      email: 'owner@test.teamflow',
      role: 'PROJECT_MANAGER',
    })

    const outsider = await createUser({
      name: 'Outsider',
      email: 'outsider@test.teamflow',
      role: 'TEAM_MEMBER',
    })

    const ownerToken = await login(manager.email)
    const outsiderToken = await login(outsider.email)

    const projectResponse = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ name: 'Private Project', status: 'ACTIVE' })

    const projectId = projectResponse.body.data._id

    const response = await request(app)
      .get('/api/v1/projects/' + projectId)
      .set('Authorization', 'Bearer ' + outsiderToken)

    expect(response.status).toBe(403)
    expect(response.body.message).toBe('You are not a member of this project')
  })
})
