import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { getPostgresPool, closePostgresPool } from '../../db/postgres.js'

// Mount the opt-in routes before importing the app. This suite is invoked after
// PostgreSQL migrations by the test:postgres script.
process.env.POSTGRES_TASKS_ENABLED = 'true'

const [{ default: app }, { default: User }, { default: Project }] = await Promise.all([
  import('../../app.js'),
  import('../../models/User.js'),
  import('../../models/Project.js'),
])

let mongo
let token
let viewerToken
let mongoViewerId
let sqlViewerId
let sqlAssigneeId
let mongoAssigneeId
let sqlSecondAssigneeId
let mongoSecondAssigneeId
let mongoUserId
let mongoProjectId
let sqlUserId
let sqlProjectId
let projectLegacyId
let suffix

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for PostgreSQL HTTP integration tests')
  const migration = spawnSync(process.execPath, ['src/scripts/migratePostgres.js'], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
  })
  if (migration.status !== 0) {
    throw new Error(`PostgreSQL migration failed before HTTP tests:\n${migration.stdout}\n${migration.stderr}`)
  }
  mongo = await MongoMemoryServer.create()
  await mongoose.connect(mongo.getUri())
  suffix = randomUUID()
  const passwordHash = await bcrypt.hash('Password123!', 10)
  const user = await User.create({
    name: 'PostgreSQL HTTP Owner',
    email: `postgres-http-${suffix}@example.test`,
    passwordHash,
    role: 'PROJECT_MANAGER',
    status: 'ACTIVE',
  })
  mongoUserId = String(user._id)
  const login = await request(app).post('/api/v1/auth/login')
    .send({ email: user.email, password: 'Password123!' })
  expect(login.status).toBe(200)
  token = login.body.data.token

  const viewerUser = await User.create({
    name: 'PostgreSQL HTTP Viewer',
    email: `postgres-http-viewer-${suffix}@example.test`,
    passwordHash,
    role: 'TEAM_MEMBER',
    status: 'ACTIVE',
  })
  mongoViewerId = String(viewerUser._id)
  const viewerLogin = await request(app).post('/api/v1/auth/login')
    .send({ email: viewerUser.email, password: 'Password123!' })
  expect(viewerLogin.status).toBe(200)
  viewerToken = viewerLogin.body.data.token

  const project = await Project.create({
    name: 'PostgreSQL HTTP project',
    description: 'End-to-end route test',
    ownerId: user._id,
    status: 'ACTIVE',
  })
  mongoProjectId = String(project._id)
  projectLegacyId = mongoProjectId

  const pool = getPostgresPool()
  const sqlUser = await pool.query(
    `INSERT INTO users (name,email,password_hash,status,role,legacy_mongo_id)
     VALUES ($1,$2,$3,'ACTIVE','PROJECT_MANAGER',$4) RETURNING id`,
    ['PostgreSQL HTTP Owner', `sql-${suffix}@example.test`, 'test-only-hash', mongoUserId],
  )
  sqlUserId = sqlUser.rows[0].id
  const sqlProject = await pool.query(
    `INSERT INTO projects (name,owner_id,status,legacy_mongo_id)
     VALUES ($1,$2,'ACTIVE',$3) RETURNING id`,
    ['PostgreSQL HTTP project', sqlUserId, projectLegacyId],
  )
  sqlProjectId = sqlProject.rows[0].id
  const sqlViewer = await pool.query(
    `INSERT INTO users (name,email,password_hash,status,role,legacy_mongo_id)
     VALUES ($1,$2,$3,'ACTIVE','TEAM_MEMBER',$4) RETURNING id`,
    ['PostgreSQL HTTP Viewer', `sql-viewer-${suffix}@example.test`, 'test-only-hash', mongoViewerId],
  )
  sqlViewerId = sqlViewer.rows[0].id
  await pool.query(
    'INSERT INTO project_members (project_id,user_id,project_role) VALUES ($1,$2,$3)',
    [sqlProjectId, sqlViewerId, 'VIEWER'],
  )

  mongoAssigneeId = randomUUID().replaceAll('-', '').slice(0, 24)
  const sqlAssignee = await pool.query(
    `INSERT INTO users (name,email,password_hash,status,role,legacy_mongo_id)
     VALUES ($1,$2,$3,'ACTIVE','TEAM_MEMBER',$4) RETURNING id`,
    ['PostgreSQL HTTP Assignee', `sql-assignee-${suffix}@example.test`, 'test-only-hash', mongoAssigneeId],
  )
  sqlAssigneeId = sqlAssignee.rows[0].id
  await pool.query(
    'INSERT INTO project_members (project_id,user_id,project_role) VALUES ($1,$2,$3)',
    [sqlProjectId, sqlAssigneeId, 'MEMBER'],
  )

  mongoSecondAssigneeId = randomUUID().replaceAll('-', '').slice(0, 24)
  const sqlSecondAssignee = await pool.query(
    `INSERT INTO users (name,email,password_hash,status,role,legacy_mongo_id)
     VALUES ($1,$2,$3,'ACTIVE','TEAM_MEMBER',$4) RETURNING id`,
    ['PostgreSQL HTTP Reassigned Member', `sql-reassigned-${suffix}@example.test`, 'test-only-hash', mongoSecondAssigneeId],
  )
  sqlSecondAssigneeId = sqlSecondAssignee.rows[0].id
  await pool.query(
    'INSERT INTO project_members (project_id,user_id,project_role) VALUES ($1,$2,$3)',
    [sqlProjectId, sqlSecondAssigneeId, 'MEMBER'],
  )

  const board = await pool.query(
    'INSERT INTO boards (project_id,name,created_by) VALUES ($1,$2,$3) RETURNING id',
    [sqlProjectId, 'HTTP integration board', sqlUserId],
  )
  await pool.query(
    'INSERT INTO board_columns (board_id,name,position) VALUES ($1,$2,0),($1,$3,1)',
    [board.rows[0].id, 'To Do', 'In Progress'],
  )
})

afterAll(async () => {
  const pool = process.env.DATABASE_URL ? getPostgresPool() : null
  try {
    if (pool && sqlProjectId) await pool.query('DELETE FROM projects WHERE id=$1', [sqlProjectId])
    if (pool && (sqlUserId || sqlViewerId)) await pool.query('DELETE FROM activity_logs WHERE user_id = ANY($1::uuid[])', [[sqlUserId, sqlViewerId].filter(Boolean)])
    if (pool && sqlUserId) await pool.query('DELETE FROM users WHERE id=$1', [sqlUserId])
    if (pool && sqlViewerId) await pool.query('DELETE FROM users WHERE id=$1', [sqlViewerId])
    if (pool && sqlAssigneeId) await pool.query('DELETE FROM users WHERE id=$1', [sqlAssigneeId])
    if (pool && sqlSecondAssigneeId) await pool.query('DELETE FROM users WHERE id=$1', [sqlSecondAssigneeId])
  } finally {
    await closePostgresPool()
    await mongoose.disconnect()
    await mongo?.stop()
  }
})

describe('PostgreSQL task HTTP flow with feature flag enabled', () => {
  it('requires a valid JWT before accessing PostgreSQL task routes', async () => {
    const response = await request(app)
      .get('/api/v1/postgres/tasks/project/' + projectLegacyId)
    expect(response.status).toBe(401)
  })

  it('creates PostgreSQL task-assignment notifications and respects recipient preferences', async () => {
    const pool = getPostgresPool()
    const enabledTask = await request(app)
      .post('/api/v1/postgres/tasks/project/' + projectLegacyId)
      .set('Authorization', 'Bearer ' + token)
      .send({ title: 'Assignment notification enabled', assigneeId: mongoAssigneeId })
    expect(enabledTask.status).toBe(201)

    const enabledNotification = await pool.query(
      `SELECT type,message,entity_id FROM notifications WHERE user_id=$1 AND entity_id=$2`,
      [sqlAssigneeId, enabledTask.body.data.id],
    )
    expect(enabledNotification.rows).toHaveLength(1)
    expect(enabledNotification.rows[0].type).toBe('TASK_ASSIGNED')
    expect(enabledNotification.rows[0].message).toBe('A new task was assigned to you: Assignment notification enabled')

    const reassignedTask = await request(app)
      .patch('/api/v1/postgres/tasks/' + enabledTask.body.data.id)
      .set('Authorization', 'Bearer ' + token)
      .send({ assigneeId: mongoSecondAssigneeId, version: enabledTask.body.data.version })
    expect(reassignedTask.status).toBe(200)
    const reassignmentNotification = await pool.query(
      `SELECT type,message FROM notifications WHERE user_id=$1 AND entity_id=$2`,
      [sqlSecondAssigneeId, enabledTask.body.data.id],
    )
    expect(reassignmentNotification.rows).toHaveLength(1)
    expect(reassignmentNotification.rows[0].type).toBe('TASK_ASSIGNED')
    expect(reassignmentNotification.rows[0].message).toBe('A task was assigned to you: Assignment notification enabled')

    await pool.query(
      `UPDATE users SET preferences=jsonb_set(preferences,'{notifications,taskAssignment}','false'::jsonb,true) WHERE id=$1`,
      [sqlAssigneeId],
    )
    const disabledTask = await request(app)
      .post('/api/v1/postgres/tasks/project/' + projectLegacyId)
      .set('Authorization', 'Bearer ' + token)
      .send({ title: 'Assignment notification disabled', assigneeId: mongoAssigneeId })
    expect(disabledTask.status).toBe(201)
    const disabledNotification = await pool.query(
      `SELECT id FROM notifications WHERE user_id=$1 AND entity_id=$2`,
      [sqlAssigneeId, disabledTask.body.data.id],
    )
    expect(disabledNotification.rows).toHaveLength(0)
  })

  it('authenticates through MongoDB and creates, lists, and updates a PostgreSQL task over HTTP', async () => {
    const created = await request(app)
      .post('/api/v1/postgres/tasks/project/' + projectLegacyId)
      .set('Authorization', 'Bearer ' + token)
      .send({ title: 'HTTP PostgreSQL task', priority: 'HIGH', labels: ['Urgent', 'Frontend'] })
    expect(created.status).toBe(201)
    expect(created.body.success).toBe(true)
    expect(created.body.data.title).toBe('HTTP PostgreSQL task')
    expect(created.body.data.status).toBe('TODO')
    expect(created.body.data.id).toBeTruthy()
    expect(created.body.data.labels).toEqual(['Frontend', 'Urgent'])

    const suggestions = await request(app)
      .get('/api/v1/postgres/tasks/' + created.body.data.id + '/assignment-suggestions')
      .set('Authorization', 'Bearer ' + token)
    expect(suggestions.status).toBe(200)
    expect(Array.isArray(suggestions.body.data)).toBe(true)

    const listed = await request(app)
      .get('/api/v1/postgres/tasks/project/' + projectLegacyId + '?status=TODO&priority=HIGH')
      .set('Authorization', 'Bearer ' + token)
    expect(listed.status).toBe(200)
    expect(listed.body.data.some((task) => task.id === created.body.data.id)).toBe(true)

    const labelFiltered = await request(app)
      .get('/api/v1/postgres/tasks/project/' + projectLegacyId + '?label=Urgent')
      .set('Authorization', 'Bearer ' + token)
    expect(labelFiltered.status).toBe(200)
    expect(labelFiltered.body.data.some((task) => task.id === created.body.data.id)).toBe(true)

    const updated = await request(app)
      .patch('/api/v1/postgres/tasks/' + created.body.data.id)
      .set('Authorization', 'Bearer ' + token)
      .send({ title: 'Updated HTTP PostgreSQL task', status: 'IN_PROGRESS', labels: ['Backend'], version: created.body.data.version })
    expect(updated.status).toBe(200)
    expect(updated.body.data.title).toBe('Updated HTTP PostgreSQL task')
    expect(updated.body.data.status).toBe('IN_PROGRESS')
    expect(updated.body.data.version).toBe(created.body.data.version + 1)
    expect(updated.body.data.labels).toEqual(['Backend'])

    const taskActivity = await request(app)
      .get('/api/v1/postgres/tasks/' + created.body.data.id + '/activity')
      .set('Authorization', 'Bearer ' + token)
    expect(taskActivity.status).toBe(200)
    expect(taskActivity.body.data.map((item) => item.action)).toEqual(
      expect.arrayContaining(['TASK_CREATED', 'TASK_UPDATED']),
    )

    const viewerAssignment = await request(app)
      .patch('/api/v1/postgres/tasks/' + created.body.data.id)
      .set('Authorization', 'Bearer ' + token)
      .send({ assigneeId: mongoViewerId, version: updated.body.data.version })
    expect(viewerAssignment.status).toBe(422)
    expect(viewerAssignment.body.message).toContain('Viewers cannot be assigned')

    const invalidCommentTaskId = await request(app)
      .get('/api/v1/postgres/tasks/not-a-task-id/comments')
      .set('Authorization', 'Bearer ' + token)
    expect(invalidCommentTaskId.status).toBe(400)

    const comment = await request(app)
      .post('/api/v1/postgres/tasks/' + created.body.data.id + '/comments')
      .set('Authorization', 'Bearer ' + token)
      .send({ message: 'PostgreSQL comment integration test' })
    expect(comment.status).toBe(201)
    expect(comment.body.data.message).toBe('PostgreSQL comment integration test')
    expect(comment.body.data.userId.name).toBe('PostgreSQL HTTP Owner')

    const comments = await request(app)
      .get('/api/v1/postgres/tasks/' + created.body.data.id + '/comments')
      .set('Authorization', 'Bearer ' + token)
    expect(comments.status).toBe(200)
    expect(comments.body.data.some((item) => item.id === comment.body.data.id)).toBe(true)

    const viewerComment = await request(app)
      .post('/api/v1/postgres/tasks/' + created.body.data.id + '/comments')
      .set('Authorization', 'Bearer ' + viewerToken)
      .send({ message: 'Viewer comments remain compatible with the existing API' })
    expect(viewerComment.status).toBe(201)
    const viewerCannotUpdateTask = await request(app)
      .patch('/api/v1/postgres/tasks/' + created.body.data.id)
      .set('Authorization', 'Bearer ' + viewerToken)
      .send({ title: 'Viewer must not edit task' })
    expect(viewerCannotUpdateTask.status).toBe(403)
    expect(viewerCannotUpdateTask.body.success).toBe(false)

    const commentActivity = await request(app)
      .get('/api/v1/postgres/tasks/' + created.body.data.id + '/activity')
      .set('Authorization', 'Bearer ' + token)
    expect(commentActivity.status).toBe(200)
    expect(commentActivity.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'activity', action: 'TASK_CREATED', message: 'created the task' }),
      expect.objectContaining({ type: 'activity', action: 'COMMENT_ADDED', message: 'commented on the task' }),
      expect.objectContaining({ type: 'comment', action: 'COMMENT_ADDED', message: 'PostgreSQL comment integration test' }),
      expect.objectContaining({ type: 'comment', action: 'COMMENT_ADDED', message: 'Viewer comments remain compatible with the existing API' }),
    ]))
    expect(commentActivity.body.data.every((event) => event.createdAt)).toBe(true)

    const predecessor = await request(app)
      .post('/api/v1/postgres/tasks/project/' + projectLegacyId)
      .set('Authorization', 'Bearer ' + token)
      .send({ title: 'PostgreSQL dependency predecessor' })
    expect(predecessor.status).toBe(201)

    const dependency = await request(app)
      .post('/api/v1/postgres/tasks/' + created.body.data.id + '/dependencies')
      .set('Authorization', 'Bearer ' + token)
      .send({ predecessorTaskId: predecessor.body.data.id })
    expect(dependency.status).toBe(201)
    expect(dependency.body.data.predecessorTaskId.title).toBe('PostgreSQL dependency predecessor')

    const dependencies = await request(app)
      .get('/api/v1/postgres/tasks/' + created.body.data.id + '/dependencies')
      .set('Authorization', 'Bearer ' + token)
    expect(dependencies.status).toBe(200)
    expect(dependencies.body.data).toHaveLength(1)

    const blockers = await request(app)
      .get('/api/v1/postgres/tasks/' + created.body.data.id + '/blockers')
      .set('Authorization', 'Bearer ' + token)
    expect(blockers.status).toBe(200)
    expect(blockers.body.data).toHaveLength(1)

    const blockedTransition = await request(app)
      .patch('/api/v1/postgres/tasks/' + created.body.data.id)
      .set('Authorization', 'Bearer ' + token)
      .send({ status: 'COMPLETED', version: updated.body.data.version })
    expect(blockedTransition.status).toBe(409)
    expect(blockedTransition.body.message).toContain('blocked by')

    const cycle = await request(app)
      .post('/api/v1/postgres/tasks/' + predecessor.body.data.id + '/dependencies')
      .set('Authorization', 'Bearer ' + token)
      .send({ predecessorTaskId: created.body.data.id })
    expect(cycle.status).toBe(422)

    const removedDependency = await request(app)
      .delete('/api/v1/postgres/tasks/' + created.body.data.id + '/dependencies/' + dependency.body.data.id)
      .set('Authorization', 'Bearer ' + token)
    expect(removedDependency.status).toBe(200)

    const stale = await request(app)
      .patch('/api/v1/postgres/tasks/' + created.body.data.id)
      .set('Authorization', 'Bearer ' + token)
      .send({ title: 'Stale HTTP update', version: created.body.data.version })
    expect(stale.status).toBe(409)
    expect(stale.body.success).toBe(false)
    expect(stale.body.message).toContain('changed by another user')

    const invalidId = await request(app)
      .patch('/api/v1/postgres/tasks/not-a-task-id')
      .set('Authorization', 'Bearer ' + token)
      .send({ title: 'Invalid ID update' })
    expect(invalidId.status).toBe(400)
    expect(invalidId.body.message).toContain('Invalid task id')

    const missingProject = await request(app)
      .get('/api/v1/postgres/tasks/project/0123456789abcdef01234567')
      .set('Authorization', 'Bearer ' + token)
    expect(missingProject.status).toBe(404)
    expect(missingProject.body.message).toContain('not migrated')
  })

  it('matches MongoDB label, due-date range, unassigned, and filter validation semantics', async () => {
    const first = await request(app)
      .post('/api/v1/postgres/tasks/project/' + projectLegacyId)
      .set('Authorization', 'Bearer ' + token)
      .send({ title: 'Filter parity release task', dueDate: '2026-12-03T12:00:00.000Z', labels: ['Release'] })
    expect(first.status).toBe(201)

    const second = await request(app)
      .post('/api/v1/postgres/tasks/project/' + projectLegacyId)
      .set('Authorization', 'Bearer ' + token)
      .send({ title: 'Filter parity planning task', dueDate: '2026-12-10T12:00:00.000Z', labels: ['Planning'] })
    expect(second.status).toBe(201)

    const range = await request(app)
      .get('/api/v1/postgres/tasks/project/' + projectLegacyId + '?dueDateFrom=2026-12-01&dueDateTo=2026-12-05')
      .set('Authorization', 'Bearer ' + token)
    expect(range.status).toBe(200)
    expect(range.body.data.map((task) => task.id)).toContain(first.body.data.id)
    expect(range.body.data.map((task) => task.id)).not.toContain(second.body.data.id)

    const exactLabel = await request(app)
      .get('/api/v1/postgres/tasks/project/' + projectLegacyId + '?label=Release')
      .set('Authorization', 'Bearer ' + token)
    expect(exactLabel.status).toBe(200)
    expect(exactLabel.body.data.map((task) => task.id)).toContain(first.body.data.id)

    const differentCaseLabel = await request(app)
      .get('/api/v1/postgres/tasks/project/' + projectLegacyId + '?label=release')
      .set('Authorization', 'Bearer ' + token)
    expect(differentCaseLabel.status).toBe(200)
    expect(differentCaseLabel.body.data.map((task) => task.id)).not.toContain(first.body.data.id)

    const unassigned = await request(app)
      .get('/api/v1/postgres/tasks/project/' + projectLegacyId + '?assigneeId=unassigned')
      .set('Authorization', 'Bearer ' + token)
    expect(unassigned.status).toBe(200)
    expect(unassigned.body.data.every((task) => task.assigneeId === null)).toBe(true)

    const invalidRange = await request(app)
      .get('/api/v1/postgres/tasks/project/' + projectLegacyId + '?dueDateFrom=2026-12-10&dueDateTo=2026-12-01')
      .set('Authorization', 'Bearer ' + token)
    expect(invalidRange.status).toBe(400)
    expect(invalidRange.body.message).toContain('on or before')

    const invalidLabel = await request(app)
      .get('/api/v1/postgres/tasks/project/' + projectLegacyId + '?label=%20')
      .set('Authorization', 'Bearer ' + token)
    expect(invalidLabel.status).toBe(400)

    const invalidAssignee = await request(app)
      .get('/api/v1/postgres/tasks/project/' + projectLegacyId + '?assigneeId=')
      .set('Authorization', 'Bearer ' + token)
    expect(invalidAssignee.status).toBe(400)
  })

  it('denies viewer writes at the HTTP boundary', async () => {
    const response = await request(app)
      .post('/api/v1/postgres/tasks/project/' + projectLegacyId)
      .set('Authorization', 'Bearer ' + viewerToken)
      .send({ title: 'Viewer must not create' })
    expect(response.status).toBe(403)
    expect(response.body.success).toBe(false)
    expect(response.body.message).toContain('read-only')
  })

  it('returns a clear mapping error for an authenticated user not mapped into PostgreSQL', async () => {
    const other = await User.create({
      name: 'Unmapped HTTP User',
      email: `unmapped-${suffix}@example.test`,
      passwordHash: await bcrypt.hash('Password123!', 10),
      role: 'TEAM_MEMBER',
      status: 'ACTIVE',
    })
    const login = await request(app).post('/api/v1/auth/login')
      .send({ email: other.email, password: 'Password123!' })
    expect(login.status).toBe(200)
    const response = await request(app)
      .get('/api/v1/postgres/tasks/project/' + projectLegacyId)
      .set('Authorization', 'Bearer ' + login.body.data.token)
    expect(response.status).toBe(403)
    expect(response.body.message).toContain('not mapped')
  })
})
