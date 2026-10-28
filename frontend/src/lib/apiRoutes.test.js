import test from 'node:test'
import assert from 'node:assert/strict'
import { routePath } from './apiRoutes.js'

test('keeps MongoDB routes unchanged when PostgreSQL mode is off', () => {
  for (const path of ['/projects', '/tasks/project/p1', '/invitations', '/comments/tasks/t1/comments', '/auth/profile']) {
    assert.equal(routePath(path, false), path)
  }
})

test('maps project collection and project details to PostgreSQL', () => {
  assert.equal(routePath('/projects', true), '/postgres/projects')
  assert.equal(routePath('/projects?status=ACTIVE', true), '/postgres/projects?status=ACTIVE')
  assert.equal(routePath('/projects/p1', true), '/postgres/projects/p1')
})

test('maps project invitation list and create endpoints', () => {
  assert.equal(routePath('/projects/p1/invitations', true), '/postgres/invitations/project/p1')
})

test('maps invitation inbox and response endpoints', () => {
  assert.equal(routePath('/invitations', true), '/postgres/invitations/mine')
  assert.equal(routePath('/invitations/i1', true), '/postgres/invitations/i1')
})

test('maps task CRUD, dependencies, comments, and activity endpoints', () => {
  assert.equal(routePath('/tasks/project/p1?limit=10', true), '/postgres/tasks/project/p1?limit=10')
  assert.equal(routePath('/tasks/t1', true), '/postgres/tasks/t1')
  assert.equal(routePath('/tasks/t1/dependencies', true), '/postgres/tasks/t1/dependencies')
  assert.equal(routePath('/tasks/t1/assignment-suggestions', true), '/postgres/tasks/t1/assignment-suggestions')
  assert.equal(routePath('/comments/tasks/t1/comments', true), '/postgres/tasks/t1/comments')
})

test('maps settings, dashboard, search, activity, and notifications', () => {
  assert.equal(routePath('/settings/preferences', true), '/postgres/settings/preferences')
  assert.equal(routePath('/dashboard/summary', true), '/postgres/dashboard/summary')
  assert.equal(routePath('/search?q=alpha', true), '/postgres/search?q=alpha')
  assert.equal(routePath('/activity', true), '/postgres/activity')
  assert.equal(routePath('/notifications', true), '/postgres/notifications')
  assert.equal(routePath('/notifications/n1/read', true), '/postgres/notifications/n1/read')
})

test('leaves authentication/profile paths on their existing routes', () => {
  assert.equal(routePath('/auth/login', true), '/auth/login')
  assert.equal(routePath('/auth/profile', true), '/auth/profile')
})
