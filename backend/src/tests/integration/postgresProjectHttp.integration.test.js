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
let ownerEmail
let viewerEmail
let ownerMongoId
let suffix
let createdProjectLegacyId
let createdProjectSqlId

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for PostgreSQL project HTTP integration tests')
  const migration = spawnSync(process.execPath, ['src/scripts/migratePostgres.js'], {
    cwd: process.cwd(), env: process.env, encoding: 'utf8',
  })
  if (migration.status !== 0) throw new Error(`PostgreSQL migration failed:\n${migration.stdout}\n${migration.stderr}`)
  mongo = await MongoMemoryServer.create()
  await mongoose.connect(mongo.getUri())
  suffix = randomUUID()
  ownerEmail = `pg-project-owner-${suffix}@example.test`
  viewerEmail = `pg-project-viewer-${suffix}@example.test`
  const passwordHash = await bcrypt.hash('Password123!', 10)
  const [ownerUser] = await User.create([
    { name: 'PostgreSQL Project Owner', email: ownerEmail, passwordHash, role: 'PROJECT_MANAGER', status: 'ACTIVE' },
    { name: 'PostgreSQL Project Viewer', email: viewerEmail, passwordHash, role: 'TEAM_MEMBER', status: 'ACTIVE' },
  ])
  ownerMongoId = String(ownerUser._id)
  const ownerLogin = await request(app).post('/api/v1/auth/login').send({ email: ownerEmail, password: 'Password123!' })
  const viewerLogin = await request(app).post('/api/v1/auth/login').send({ email: viewerEmail, password: 'Password123!' })
  expect(ownerLogin.status).toBe(200)
  expect(viewerLogin.status).toBe(200)
  ownerToken = ownerLogin.body.data.token
  viewerToken = viewerLogin.body.data.token
})

afterAll(async () => {
  try {
    if (!process.env.DATABASE_URL || !suffix) return
    const pool = getPostgresPool()
    const testEmails = [
      `pg-project-owner-${suffix}@example.test`,
      `pg-project-viewer-${suffix}@example.test`,
    ]

    // Clean all references owned by this randomized fixture before deleting
    // users. Explicitly delete notifications as well as audit rows: these
    // tables may retain restrictive foreign keys even after project deletion.
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const testUsers = await client.query(
        'SELECT id FROM users WHERE email = ANY($1::text[])',
        [testEmails],
      )
      const testUserIds = testUsers.rows.map((row) => row.id)

      if (createdProjectSqlId) {
        await client.query('DELETE FROM projects WHERE id=$1', [createdProjectSqlId])
      }
      if (testUserIds.length) {
        await client.query('DELETE FROM notifications WHERE user_id = ANY($1::uuid[])', [testUserIds])
        await client.query('DELETE FROM activity_logs WHERE user_id = ANY($1::uuid[])', [testUserIds])
      }
      if (createdProjectSqlId) {
        await client.query('DELETE FROM notifications WHERE entity_id=$1', [createdProjectSqlId])
        await client.query('DELETE FROM activity_logs WHERE entity_id=$1', [createdProjectSqlId])
      }
      await client.query('DELETE FROM users WHERE email = ANY($1::text[])', [testEmails])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  } finally {
    await closePostgresPool()
    await mongoose.disconnect()
    await mongo?.stop()
  }
})

describe('PostgreSQL project HTTP flow with feature flag enabled', () => {
  it('requires authentication', async () => {
    const response = await request(app).get('/api/v1/postgres/projects')
    expect(response.status).toBe(401)
  })

  it('creates a project with owner membership and default board columns, then lists, fetches, and updates it', async () => {
    const created = await request(app).post('/api/v1/postgres/projects')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'PostgreSQL project integration',
        description: 'created through HTTP',
        status: 'ACTIVE',
        startDate: '2026-10-01',
        dueDate: '2026-11-01',
      })
    expect(created.status).toBe(201)
    expect(created.body.success).toBe(true)
    expect(created.body.data.name).toBe('PostgreSQL project integration')
    expect(created.body.data._id).toMatch(/^[a-f\d]{24}$/i)
    expect(created.body.data.projectRole).toBe('PROJECT_MANAGER')
    createdProjectLegacyId = created.body.data._id
    createdProjectSqlId = created.body.data.id

    const dashboard = await request(app).get('/api/v1/postgres/dashboard/summary')
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(dashboard.status).toBe(200)
    expect(dashboard.body.data).toMatchObject({ activeProjects: expect.any(Number), openTasks: expect.any(Number), completedTasks: expect.any(Number), overdueTasks: expect.any(Number) })
    const projectSearch = await request(app).get('/api/v1/postgres/search?q=PostgreSQL%20project%20integration&scope=projects')
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(projectSearch.status).toBe(200)
    expect(projectSearch.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'PROJECT', title: 'PostgreSQL project integration' })]))

    const pool = getPostgresPool()
    const projectRows = await pool.query('SELECT id FROM projects WHERE id=$1', [createdProjectSqlId])
    expect(projectRows.rowCount).toBe(1)
    const membership = await pool.query(
      `SELECT project_role FROM project_members WHERE project_id=$1 AND user_id=(SELECT owner_id FROM projects WHERE id=$1)`,
      [createdProjectSqlId],
    )
    expect(membership.rows[0].project_role).toBe('PROJECT_MANAGER')
    const board = await pool.query('SELECT id FROM boards WHERE project_id=$1', [createdProjectSqlId])
    expect(board.rowCount).toBe(1)
    const columns = await pool.query('SELECT name,position,is_done FROM board_columns WHERE board_id=$1 ORDER BY position', [board.rows[0].id])
    expect(columns.rows.map((row) => row.name)).toEqual(['To Do', 'In Progress', 'Review', 'Done'])
    expect(columns.rows[3].is_done).toBe(true)

    const listed = await request(app).get('/api/v1/postgres/projects')
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(listed.status).toBe(200)
    expect(listed.body.data.some((project) => project.id === createdProjectSqlId)).toBe(true)

    const fetched = await request(app).get(`/api/v1/postgres/projects/${createdProjectLegacyId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(fetched.status).toBe(200)
    expect(fetched.body.data.id).toBe(createdProjectSqlId)

    const updated = await request(app).patch(`/api/v1/postgres/projects/${createdProjectLegacyId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Updated PostgreSQL project', status: 'ON_HOLD' })
    expect(updated.status).toBe(200)
    expect(updated.body.data.name).toBe('Updated PostgreSQL project')
    expect(updated.body.data.status).toBe('ON_HOLD')

    const analytics = await request(app)
      .get(`/api/v1/postgres/projects/${createdProjectLegacyId}/analytics`)
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(analytics.status).toBe(200)
    expect(analytics.body.data.projectId).toBe(createdProjectLegacyId)
    expect(analytics.body.data.totals).toMatchObject({ total: 0, completed: 0, open: 0, overdue: 0 })

    const insights = await request(app)
      .get(`/api/v1/postgres/projects/${createdProjectLegacyId}/insights`)
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(insights.status).toBe(200)
    expect(insights.body.data.projectId).toBe(createdProjectLegacyId)
    expect(insights.body.data.insights).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ON_TRACK' }),
    ]))

    const dashboardAfterProjectUpdate = await request(app).get('/api/v1/postgres/dashboard/summary')
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(dashboardAfterProjectUpdate.status).toBe(200)
    expect(dashboardAfterProjectUpdate.body.data).toMatchObject({
      activeProjects: 0,
      openTasks: 0,
      completedTasks: 0,
      overdueTasks: 0,
    })

    const search = await request(app).get('/api/v1/postgres/search?q=Updated%20PostgreSQL')
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(search.status).toBe(200)
    expect(search.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'PROJECT', id: createdProjectLegacyId, title: 'Updated PostgreSQL project' }),
    ]))

    const activityFeed = await request(app).get('/api/v1/postgres/activity')
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(activityFeed.status).toBe(200)
    expect(Array.isArray(activityFeed.body.data)).toBe(true)

    const projectActivity = await request(app)
      .get(`/api/v1/postgres/projects/${createdProjectLegacyId}/activity`)
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(projectActivity.status).toBe(200)
    expect(Array.isArray(projectActivity.body.data)).toBe(true)

    const preferences = await request(app).get('/api/v1/postgres/settings/preferences')
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(preferences.status).toBe(200)
    expect(preferences.body.data.display.compactMode).toBe(false)

    const changedPreferences = await request(app).patch('/api/v1/postgres/settings/preferences')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ display: { compactMode: true }, notifications: { teamUpdates: false } })
    expect(changedPreferences.status).toBe(200)
    expect(changedPreferences.body.data.display.compactMode).toBe(true)
    expect(changedPreferences.body.data.notifications.teamUpdates).toBe(false)

    const preferencesBefore = await request(app).get('/api/v1/postgres/settings/preferences')
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(preferencesBefore.status).toBe(200)
    expect(preferencesBefore.body.data.notifications.projectInvitation).toBe(true)
    const invalidPreference = await request(app).patch('/api/v1/postgres/settings/preferences')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ notifications: { projectInvitation: 'no' } })
    expect(invalidPreference.status).toBe(400)
    const updatedPreference = await request(app).patch('/api/v1/postgres/settings/preferences')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ notifications: { chatMention: false }, display: { compactMode: true } })
    expect(updatedPreference.status).toBe(200)
    expect(updatedPreference.body.data.notifications.chatMention).toBe(false)
    expect(updatedPreference.body.data.notifications.projectInvitation).toBe(true)
    expect(updatedPreference.body.data.display.compactMode).toBe(true)
    const persistedPreference = await request(app).get('/api/v1/postgres/settings/preferences')
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(persistedPreference.body.data.notifications.chatMention).toBe(false)
    expect(persistedPreference.body.data.display.compactMode).toBe(true)

    const invalidPreferences = await request(app).patch('/api/v1/postgres/settings/preferences')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ notifications: { madeUpPreference: true } })
    expect(invalidPreferences.status).toBe(400)
  })

  it('blocks non-members and rejects invalid project payloads', async () => {
    const forbidden = await request(app).get(`/api/v1/postgres/projects/${createdProjectLegacyId}`)
      .set('Authorization', `Bearer ${viewerToken}`)
    expect(forbidden.status).toBe(403)

    const invalid = await request(app).post('/api/v1/postgres/projects')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Date order validation', startDate: '2026-12-01', dueDate: '2026-11-01' })
    expect(invalid.status).toBe(400)
  })

  it('manages PostgreSQL project membership and writes notification/activity records', async () => {
    const viewer = await User.findOne({ email: viewerEmail }).lean()
    const pool = getPostgresPool()
    await pool.query(
      `INSERT INTO users (name,email,password_hash,status,role,legacy_mongo_id)
       VALUES ($1,$2,$3,'ACTIVE','TEAM_MEMBER',$4)
       ON CONFLICT (legacy_mongo_id) WHERE legacy_mongo_id IS NOT NULL
       DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,status='ACTIVE',updated_at=now()`,
      [viewer.name, viewer.email, 'test-only-hash', String(viewer._id)],
    )
    const candidates = await request(app).get(`/api/v1/postgres/projects/${createdProjectLegacyId}/members/candidates?q=PostgreSQL`)
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(candidates.status).toBe(200)
    expect(candidates.body.data.some((item) => item.userId === String(viewer._id))).toBe(true)

    const added = await request(app).post(`/api/v1/postgres/projects/${createdProjectLegacyId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: String(viewer._id), projectRole: 'VIEWER' })
    expect(added.status).toBe(201)
    expect(added.body.data.projectRole).toBe('VIEWER')

    const duplicate = await request(app).post(`/api/v1/postgres/projects/${createdProjectLegacyId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: String(viewer._id), projectRole: 'VIEWER' })
    expect(duplicate.status).toBe(409)

    const invalidRole = await request(app).post(`/api/v1/postgres/projects/${createdProjectLegacyId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: String(viewer._id), projectRole: 'INVALID_ROLE' })
    expect(invalidRole.status).toBe(400)

    const viewerCannotManageMembers = await request(app).post(`/api/v1/postgres/projects/${createdProjectLegacyId}/members`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ userId: ownerMongoId, projectRole: 'MEMBER' })
    expect(viewerCannotManageMembers.status).toBe(403)

    const listed = await request(app).get(`/api/v1/postgres/projects/${createdProjectLegacyId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(listed.status).toBe(200)
    expect(listed.body.data.some((member) => member.userId === String(viewer._id) && member.projectRole === 'VIEWER')).toBe(true)

    const updated = await request(app).patch(`/api/v1/postgres/projects/${createdProjectLegacyId}/members/${String(viewer._id)}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ projectRole: 'MEMBER' })
    expect(updated.status).toBe(200)
    expect(updated.body.data.projectRole).toBe('MEMBER')

    const assignmentSuggestions = await request(app)
      .get(`/api/v1/postgres/projects/${createdProjectLegacyId}/assignment-suggestions?priority=HIGH&estimateMinutes=90`)
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(assignmentSuggestions.status).toBe(200)
    expect(assignmentSuggestions.body.data.some((item) => item.userId === String(viewer._id))).toBe(true)

    const protectedOwnerRole = await request(app).patch('/api/v1/postgres/projects/' + createdProjectLegacyId + '/members/' + ownerMongoId)
      .set('Authorization', 'Bearer ' + ownerToken)
      .send({ projectRole: 'VIEWER' })
    expect(protectedOwnerRole.status).toBe(400)

    const protectedOwnerRemoval = await request(app).delete('/api/v1/postgres/projects/' + createdProjectLegacyId + '/members/' + ownerMongoId)
      .set('Authorization', 'Bearer ' + ownerToken)
    expect(protectedOwnerRemoval.status).toBe(400)

    const notification = await pool.query(
      `SELECT id FROM notifications WHERE user_id=(SELECT id FROM users WHERE legacy_mongo_id=$1) AND type='PROJECT_MEMBER_ADDED'`,
      [String(viewer._id)],
    )
    expect(notification.rowCount).toBe(1)

    const userNotifications = await request(app).get('/api/v1/postgres/notifications')
      .set('Authorization', `Bearer ${viewerToken}`)
    expect(userNotifications.status).toBe(200)
    const memberAddedNotification = userNotifications.body.data.find((item) => item.type === 'PROJECT_MEMBER_ADDED')
    expect(memberAddedNotification).toBeTruthy()
    const invalidNotificationId = await request(app)
      .patch('/api/v1/postgres/notifications/not-a-uuid/read')
      .set('Authorization', `Bearer ${viewerToken}`)
    expect(invalidNotificationId.status).toBe(400)
    const markedRead = await request(app).patch('/api/v1/postgres/notifications/' + memberAddedNotification.id + '/read')
      .set('Authorization', `Bearer ${viewerToken}`)
    expect(markedRead.status).toBe(200)
    expect(markedRead.body.data.readAt).toBeTruthy()
    const activity = await pool.query(
      `SELECT id FROM activity_logs WHERE entity_id=$1 AND action IN ('PROJECT_MEMBER_ADDED','PROJECT_MEMBER_ROLE_UPDATED')`,
      [createdProjectSqlId],
    )
    expect(activity.rowCount).toBeGreaterThanOrEqual(2)

    // Regression: Mongo ObjectIds contain decimal digits as well as a-f.
    // Mention validation must accept all 24 hexadecimal characters. Also ensure
    // disabled chatMention preferences suppress only the notification, not the mention.
    await pool.query(
      `UPDATE users SET preferences=COALESCE(preferences,'{}'::jsonb) || jsonb_build_object(
         'notifications', COALESCE(preferences->'notifications','{}'::jsonb) || jsonb_build_object('chatMention',false)
       ) WHERE legacy_mongo_id=$1`,
      [String(viewer._id)],
    )
    const notificationsBeforeDisabledMention = await pool.query(
      `SELECT count(*)::int AS count FROM notifications
       WHERE user_id=(SELECT id FROM users WHERE legacy_mongo_id=$1)
         AND type='PROJECT_CHAT_MENTION'`,
      [String(viewer._id)],
    )
    const mutedChatMessage = await request(app).post(`/api/v1/postgres/projects/${createdProjectLegacyId}/chat`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ message: 'Muted mention regression test', mentions: [String(viewer._id)] })
    expect(mutedChatMessage.status).toBe(201)
    expect(mutedChatMessage.body.data.message).toBe('Muted mention regression test')
    expect(mutedChatMessage.body.data.mentions).toEqual(expect.arrayContaining([
      expect.objectContaining({ _id: String(viewer._id), name: viewer.name }),
    ]))
    const notificationsAfterDisabledMention = await pool.query(
      `SELECT count(*)::int AS count FROM notifications
       WHERE user_id=(SELECT id FROM users WHERE legacy_mongo_id=$1)
         AND type='PROJECT_CHAT_MENTION'`,
      [String(viewer._id)],
    )
    expect(notificationsAfterDisabledMention.rows[0].count).toBe(notificationsBeforeDisabledMention.rows[0].count)

    // Re-enable notifications and verify the normal notification path still works.
    await pool.query(
      `UPDATE users SET preferences=COALESCE(preferences,'{}'::jsonb) || jsonb_build_object(
         'notifications', COALESCE(preferences->'notifications','{}'::jsonb) || jsonb_build_object('chatMention',true)
       ) WHERE legacy_mongo_id=$1`,
      [String(viewer._id)],
    )
    const chatMessage = await request(app).post(`/api/v1/postgres/projects/${createdProjectLegacyId}/chat`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ message: 'Mention regression test', mentions: [String(viewer._id)] })
    expect(chatMessage.status).toBe(201)
    expect(chatMessage.body.data.message).toBe('Mention regression test')
    expect(chatMessage.body.data.mentions).toEqual(expect.arrayContaining([
      expect.objectContaining({ _id: String(viewer._id), name: viewer.name }),
    ]))

    const mentionNotification = await pool.query(
      `SELECT id FROM notifications
       WHERE user_id=(SELECT id FROM users WHERE legacy_mongo_id=$1)
         AND type='PROJECT_CHAT_MENTION'
       ORDER BY created_at DESC LIMIT 1`,
      [String(viewer._id)],
    )
    expect(mentionNotification.rowCount).toBe(1)

    const reacted = await request(app)
      .post(`/api/v1/postgres/projects/${createdProjectLegacyId}/chat/${chatMessage.body.data.id}/reactions`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ emoji: '👍' })
    expect(reacted.status).toBe(200)
    expect(reacted.body.data.reactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ emoji: '👍' }),
    ]))

    const removed = await request(app).delete(`/api/v1/postgres/projects/${createdProjectLegacyId}/members/${String(viewer._id)}`)
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(removed.status).toBe(200)
    const membership = await pool.query(
      `SELECT project_role FROM project_members WHERE project_id=$1 AND user_id=(SELECT id FROM users WHERE legacy_mongo_id=$2)`,
      [createdProjectSqlId, String(viewer._id)],
    )
    expect(membership.rowCount).toBe(0)
  })

  it('creates, lists, accepts, and safely rejects replayed PostgreSQL invitations', async () => {
    const invalidInvitationId = await request(app)
      .patch('/api/v1/postgres/invitations/not-a-uuid')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ action: 'ACCEPT' })
    expect(invalidInvitationId.status).toBe(400)

    const invalidInvitationAction = await request(app)
      .patch('/api/v1/postgres/invitations/00000000-0000-4000-8000-000000000001')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ action: 'MAYBE' })
    expect(invalidInvitationAction.status).toBe(400)

    const invalidInvitee = await request(app)
      .post(`/api/v1/postgres/invitations/project/${createdProjectLegacyId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ invitedUserId: 'not-an-object-id', projectRole: 'MEMBER' })
    expect(invalidInvitee.status).toBe(400)

    const viewer = await User.findOne({ email: viewerEmail }).lean()
    const pool = getPostgresPool()
    const invitedUserId = String(viewer._id)
    const viewerSqlId = (await pool.query('SELECT id FROM users WHERE legacy_mongo_id=$1', [invitedUserId])).rows[0].id

    // Disabled preference suppresses the invitation notification, not the invitation itself.
    await pool.query(
      `UPDATE users SET preferences=COALESCE(preferences,'{}'::jsonb) || jsonb_build_object(
         'notifications', COALESCE(preferences->'notifications','{}'::jsonb) || jsonb_build_object('projectInvitation',false)
       ) WHERE id=$1`,
      [viewerSqlId],
    )
    const invitationNotificationsBefore = await pool.query(
      "SELECT count(*)::int AS count FROM notifications WHERE user_id=$1 AND type='PROJECT_INVITATION'",
      [viewerSqlId],
    )

    const created = await request(app)
      .post(`/api/v1/postgres/invitations/project/${createdProjectLegacyId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ invitedUserId, projectRole: 'MEMBER' })
    expect(created.status).toBe(201)
    const invitationNotificationsAfter = await pool.query(
      "SELECT count(*)::int AS count FROM notifications WHERE user_id=$1 AND type='PROJECT_INVITATION'",
      [viewerSqlId],
    )
    expect(invitationNotificationsAfter.rows[0].count).toBe(invitationNotificationsBefore.rows[0].count)
    expect(created.body.data.invitedUserId).toMatchObject({ _id: invitedUserId, name: 'PostgreSQL Project Viewer', email: viewerEmail })
    expect(created.body.data.status).toBe('PENDING')
    const invitationId = created.body.data.id

    const duplicate = await request(app)
      .post(`/api/v1/postgres/invitations/project/${createdProjectLegacyId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ invitedUserId, projectRole: 'MEMBER' })
    expect(duplicate.status).toBe(409)

    const projectInvitations = await request(app)
      .get(`/api/v1/postgres/invitations/project/${createdProjectLegacyId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(projectInvitations.status).toBe(200)
    expect(projectInvitations.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: invitationId, status: 'PENDING', invitedUserId: expect.objectContaining({ _id: invitedUserId }) }),
    ]))

    const myInvitations = await request(app)
      .get('/api/v1/postgres/invitations/mine')
      .set('Authorization', `Bearer ${viewerToken}`)
    expect(myInvitations.status).toBe(200)
    expect(myInvitations.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: invitationId, status: 'PENDING' }),
    ]))

    const accepted = await request(app)
      .patch(`/api/v1/postgres/invitations/${invitationId}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ action: 'ACCEPT' })
    expect(accepted.status).toBe(200)
    expect(accepted.body.data.status).toBe('ACCEPTED')

    const replay = await request(app)
      .patch(`/api/v1/postgres/invitations/${invitationId}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ action: 'ACCEPT' })
    expect(replay.status).toBe(409)

    const membership = await pool.query(
      'SELECT project_role FROM project_members WHERE project_id=$1 AND user_id=(SELECT id FROM users WHERE legacy_mongo_id=$2)',
      [createdProjectSqlId, invitedUserId],
    )
    expect(membership.rows[0]?.project_role).toBe('MEMBER')

    const inviterNotification = await request(app)
      .get('/api/v1/postgres/notifications')
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(inviterNotification.status).toBe(200)
    expect(inviterNotification.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'PROJECT_INVITATION_ACCEPTED' }),
    ]))
    const acceptedNotification = inviterNotification.body.data.find((item) => item.type === 'PROJECT_INVITATION_ACCEPTED')
    expect(acceptedNotification).toBeTruthy()
    const viewerCannotReadAnotherUsersNotification = await request(app)
      .patch(`/api/v1/postgres/notifications/${acceptedNotification.id}/read`)
      .set('Authorization', `Bearer ${viewerToken}`)
    expect(viewerCannotReadAnotherUsersNotification.status).toBe(404)
    const ownerMarksOwnNotificationRead = await request(app)
      .patch(`/api/v1/postgres/notifications/${acceptedNotification.id}/read`)
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(ownerMarksOwnNotificationRead.status).toBe(200)
    expect(ownerMarksOwnNotificationRead.body.data.readAt).toBeTruthy()
    const ownerRepeatsRead = await request(app)
      .patch(`/api/v1/postgres/notifications/${acceptedNotification.id}/read`)
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(ownerRepeatsRead.status).toBe(200)
    expect(ownerRepeatsRead.body.data.readAt).toBe(ownerMarksOwnNotificationRead.body.data.readAt)

    const viewerCannotInvite = await request(app)
      .post(`/api/v1/postgres/invitations/project/${createdProjectLegacyId}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ invitedUserId: ownerMongoId, projectRole: 'MEMBER' })
    expect(viewerCannotInvite.status).toBe(403)
    const viewerCannotChangeMemberRole = await request(app)
      .patch(`/api/v1/postgres/projects/${createdProjectLegacyId}/members/${ownerMongoId}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ projectRole: 'MEMBER' })
    expect([403, 404]).toContain(viewerCannotChangeMemberRole.status)

    await request(app)
      .delete(`/api/v1/postgres/projects/${createdProjectLegacyId}/members/${invitedUserId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200)

    // Acceptance notification is controlled by the inviter's current preference.
    const ownerSqlId = (await pool.query('SELECT id FROM users WHERE legacy_mongo_id=$1', [ownerMongoId])).rows[0].id
    await pool.query(
      `UPDATE users SET preferences=COALESCE(preferences,'{}'::jsonb) || jsonb_build_object(
         'notifications', COALESCE(preferences->'notifications','{}'::jsonb) || jsonb_build_object('projectInvitation',false)
       ) WHERE id=$1`,
      [ownerSqlId],
    )
    const acceptedCountBeforeMuted = await pool.query(
      "SELECT count(*)::int AS count FROM notifications WHERE user_id=$1 AND type='PROJECT_INVITATION_ACCEPTED'",
      [ownerSqlId],
    )
    const mutedAcceptanceInvitation = await request(app)
      .post(`/api/v1/postgres/invitations/project/${createdProjectLegacyId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ invitedUserId, projectRole: 'MEMBER' })
    expect(mutedAcceptanceInvitation.status).toBe(201)
    const mutedAcceptance = await request(app)
      .patch(`/api/v1/postgres/invitations/${mutedAcceptanceInvitation.body.data.id}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ action: 'ACCEPT' })
    expect(mutedAcceptance.status).toBe(200)
    const acceptedCountAfterMuted = await pool.query(
      "SELECT count(*)::int AS count FROM notifications WHERE user_id=$1 AND type='PROJECT_INVITATION_ACCEPTED'",
      [ownerSqlId],
    )
    expect(acceptedCountAfterMuted.rows[0].count).toBe(acceptedCountBeforeMuted.rows[0].count)
    await request(app)
      .delete(`/api/v1/postgres/projects/${createdProjectLegacyId}/members/${invitedUserId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200)

    const expiringInvitation = await request(app)
      .post(`/api/v1/postgres/invitations/project/${createdProjectLegacyId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ invitedUserId, projectRole: 'MEMBER' })
    expect(expiringInvitation.status).toBe(201)
    const expiringId = expiringInvitation.body.data.id
    await pool.query("UPDATE invitations SET expires_at=now()-interval '1 minute' WHERE id=$1", [expiringId])
    const expiredResponse = await request(app)
      .patch(`/api/v1/postgres/invitations/${expiringId}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ action: 'ACCEPT' })
    expect(expiredResponse.status).toBe(409)
    const expiredRecord = await pool.query('SELECT status FROM invitations WHERE id=$1', [expiringId])
    expect(expiredRecord.rows[0]?.status).toBe('EXPIRED')
  })

  it('deletes a project only for its owner', async () => {
    const forbidden = await request(app).delete(`/api/v1/postgres/projects/${createdProjectLegacyId}`)
      .set('Authorization', `Bearer ${viewerToken}`)
    expect(forbidden.status).toBe(403)

    const deleted = await request(app).delete(`/api/v1/postgres/projects/${createdProjectLegacyId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(deleted.status).toBe(200)
    expect(deleted.body.data.deleted).toBe(true)
    createdProjectSqlId = null
    createdProjectLegacyId = null
  })
})
