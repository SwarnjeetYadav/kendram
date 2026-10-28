
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import jwt from 'jsonwebtoken'
import { io as createClient } from 'socket.io-client'

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  listProjectMessages: vi.fn(),
  listPostgresProjectMessages: vi.fn(),
  postgresAuthUserById: vi.fn(),
  getPostgresPool: vi.fn(),
}))

vi.mock('../../models/User.js', () => ({
  default: { findById: mocks.findById },
}))

vi.mock('../../config/env.js', () => ({
  env: {
    jwtSecret: 'test-only-secret-for-socket-tests',
    clientOrigins: ['http://localhost:5173'],
  },
}))

vi.mock('../../services/chat.service.js', () => ({
  listProjectMessages: mocks.listProjectMessages,
}))

vi.mock('../../services/postgresChat.service.js', () => ({
  listPostgresProjectMessages: mocks.listPostgresProjectMessages,
}))

vi.mock('../../services/postgresAuth.service.js', () => ({
  postgresAuthUserById: mocks.postgresAuthUserById,
}))

vi.mock('../../db/postgres.js', () => ({
  getPostgresPool: mocks.getPostgresPool,
}))

import {
  configureChatRealtime,
  closeChatRealtime,
  publishProjectChatMessage,
  publishProjectChatReaction,
  revokeProjectChatAccess,
} from '../../services/chatRealtime.service.js'

const SECRET = 'test-only-secret-for-socket-tests'
const PROJECT_A = 'project-a'
const PROJECT_B = 'project-b'
const removedMemberships = new Set()

let server
let address
let clients

function tokenFor(userId = 'member-1') {
  return jwt.sign({ sub: userId }, SECRET, { expiresIn: '5m' })
}

function expiredTokenFor(userId = 'member-1') {
  return jwt.sign({ sub: userId }, SECRET, { expiresIn: -1 })
}

function connectClient(token) {
  const client = createClient(`http://127.0.0.1:${address.port}`, {
    auth: token ? { token } : {},
    transports: ['websocket'],
    reconnection: false,
    timeout: 3000,
  })

  clients.push(client)
  return client
}

function waitForEvent(socket, event, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent)
      reject(new Error(`Timed out waiting for ${event}`))
    }, timeout)

    function onEvent(...args) {
      clearTimeout(timer)
      resolve(args)
    }

    socket.once(event, onEvent)
  })
}

function expectNoEvent(socket, event, timeout = 300) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent)
      resolve()
    }, timeout)

    function onEvent(...args) {
      clearTimeout(timer)
      reject(new Error(`Unexpected ${event} event: ${JSON.stringify(args)}`))
    }

    socket.once(event, onEvent)
  })
}

function joinProject(socket, projectId) {
  return new Promise((resolve, reject) => {
    socket.emit('project:join', { projectId }, (result) => {
      if (!result) return reject(new Error('Missing join acknowledgement'))
      resolve(result)
    })
  })
}

beforeEach(async () => {
  clients = []

  vi.clearAllMocks()
  removedMemberships.clear()
  mocks.getPostgresPool.mockReturnValue({ testPool: true })
  delete process.env.POSTGRES_AUTH_ENABLED
  delete process.env.POSTGRES_PROJECTS_ENABLED

  mocks.findById.mockImplementation((id) => ({
    lean: async () => ({
      _id: String(id),
      name: 'Test Member',
      email: 'member@example.test',
      role: 'TEAM_MEMBER',
      status: 'ACTIVE',
    }),
  }))

  mocks.listProjectMessages.mockImplementation(async ({ projectId, userId }) => {
    if (projectId === 'forbidden-project' || removedMemberships.has(`${projectId}:${userId}`)) {
      const error = new Error('Not a member')
      error.statusCode = 403
      throw error
    }

    return []
  })

  mocks.listPostgresProjectMessages.mockResolvedValue([])
  mocks.postgresAuthUserById.mockResolvedValue({
    id: 'member-1',
    legacy_mongo_id: 'member-1',
    name: 'Test Member',
    email: 'member@example.test',
    role: 'TEAM_MEMBER',
    status: 'ACTIVE',
  })

  server = createServer()
  configureChatRealtime(server)

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  address = server.address()
})

afterEach(async () => {
  for (const client of clients) {
    client.removeAllListeners()
    client.disconnect()
  }

  await closeChatRealtime()
})

describe('Socket.IO project chat authorization and delivery', () => {
  it('rejects a connection without an access token', async () => {
    const client = connectClient()
    const [error] = await waitForEvent(client, 'connect_error')

    expect(error.message).toMatch(/authentication required/i)
    expect(client.connected).toBe(false)
  })

  it('rejects an invalid token', async () => {
    const client = connectClient('not-a-valid-token')
    const [error] = await waitForEvent(client, 'connect_error')

    expect(error.message).toMatch(/invalid or expired access token/i)
    expect(client.connected).toBe(false)
  })

  it('rejects an expired access token', async () => {
    const client = connectClient(expiredTokenFor())
    const [error] = await waitForEvent(client, 'connect_error')

    expect(error.message).toMatch(/invalid or expired access token/i)
    expect(client.connected).toBe(false)
  })

  it('allows an authenticated member to join a project', async () => {
    const client = connectClient(tokenFor())
    await waitForEvent(client, 'connect')

    const result = await joinProject(client, PROJECT_A)

    expect(result).toEqual({ ok: true, projectId: PROJECT_A })
    expect(mocks.listProjectMessages).toHaveBeenCalledWith({
      projectId: PROJECT_A,
      userId: 'member-1',
      role: 'TEAM_MEMBER',
      limit: 1,
    })
  })

  it('denies a non-member access to a project room', async () => {
    const client = connectClient(tokenFor())
    await waitForEvent(client, 'connect')

    const result = await joinProject(client, 'forbidden-project')

    expect(result).toEqual({
      ok: false,
      message: 'You are not a member of this project',
    })

    const noMessage = expectNoEvent(client, 'chat:message')
    publishProjectChatMessage('forbidden-project', { id: 'secret-message' })

    await noMessage
  })

  it('delivers messages and reactions only to clients in the matching room', async () => {
    const memberA = connectClient(tokenFor('member-a'))
    const memberB = connectClient(tokenFor('member-b'))

    await Promise.all([
      waitForEvent(memberA, 'connect'),
      waitForEvent(memberB, 'connect'),
    ])

    expect(await joinProject(memberA, PROJECT_A)).toMatchObject({ ok: true })
    expect(await joinProject(memberB, PROJECT_B)).toMatchObject({ ok: true })

    const messageReceived = waitForEvent(memberA, 'chat:message')
    const reactionReceived = waitForEvent(memberA, 'chat:reaction')

    const unrelatedMessage = expectNoEvent(memberB, 'chat:message')
    const unrelatedReaction = expectNoEvent(memberB, 'chat:reaction')

    publishProjectChatMessage(PROJECT_A, { id: 'message-1', message: 'Hello' })
    publishProjectChatReaction(PROJECT_A, { id: 'message-1', emoji: '👍' })

    await expect(messageReceived).resolves.toEqual([
      { id: 'message-1', message: 'Hello' },
    ])
    await expect(reactionReceived).resolves.toEqual([
      { id: 'message-1', emoji: '👍' },
    ])

    await Promise.all([unrelatedMessage, unrelatedReaction])
  })

  it('stops delivering events after a client leaves the project room', async () => {
    const client = connectClient(tokenFor())
    await waitForEvent(client, 'connect')
    await joinProject(client, PROJECT_A)

    const noMessage = expectNoEvent(client, 'chat:message')
    client.emit('project:leave', { projectId: PROJECT_A })

    // Allow the leave event to be processed before publishing.
    await new Promise((resolve) => setTimeout(resolve, 50))
    publishProjectChatMessage(PROJECT_A, { id: 'after-leave' })

    await noMessage
  })

  it('revokes an already-connected member when project access is removed', async () => {
    const member = connectClient(tokenFor('member-1'))
    const otherMember = connectClient(tokenFor('member-2'))

    await Promise.all([waitForEvent(member, 'connect'), waitForEvent(otherMember, 'connect')])
    await Promise.all([joinProject(member, PROJECT_A), joinProject(otherMember, PROJECT_A)])

    await expect(revokeProjectChatAccess(PROJECT_A, 'member-1')).resolves.toBe(1)

    const revokedMemberReceivesNothing = expectNoEvent(member, 'chat:message')
    const remainingMemberReceivesMessage = waitForEvent(otherMember, 'chat:message')
    publishProjectChatMessage(PROJECT_A, { id: 'after-revocation', message: 'still authorized' })

    await expect(remainingMemberReceivesMessage).resolves.toEqual([
      { id: 'after-revocation', message: 'still authorized' },
    ])
    await revokedMemberReceivesNothing

    // Simulate the membership row being deleted before a reconnect attempt.
    removedMemberships.add(`${PROJECT_A}:member-1`)
    member.disconnect()
    const reconnected = waitForEvent(member, 'connect')
    member.connect()
    await reconnected
    await expect(joinProject(member, PROJECT_A)).resolves.toEqual({
      ok: false,
      message: 'You are not a member of this project',
    })
  })

  it('re-authenticates and rejoins the project after reconnecting', async () => {
    const client = connectClient(tokenFor())
    await waitForEvent(client, 'connect')
    expect(await joinProject(client, PROJECT_A)).toMatchObject({ ok: true })

    client.disconnect()
    const reconnected = waitForEvent(client, 'connect')
    client.connect()
    await reconnected

    expect(await joinProject(client, PROJECT_A)).toMatchObject({ ok: true })
    const received = waitForEvent(client, 'chat:message')
    publishProjectChatMessage(PROJECT_A, { id: 'after-reconnect', message: 'connected again' })
    await expect(received).resolves.toEqual([
      { id: 'after-reconnect', message: 'connected again' },
    ])
    expect(mocks.listProjectMessages).toHaveBeenCalledTimes(2)
  })

  it('denies PostgreSQL project-room joins when membership authorization fails', async () => {
    process.env.POSTGRES_PROJECTS_ENABLED = 'true'
    const forbidden = new Error('Not a member')
    forbidden.statusCode = 403
    mocks.listPostgresProjectMessages.mockRejectedValueOnce(forbidden)

    const client = connectClient(tokenFor())
    await waitForEvent(client, 'connect')
    const result = await joinProject(client, PROJECT_A)

    expect(result).toMatchObject({ ok: false, message: 'You are not a member of this project' })
    expect(mocks.listPostgresProjectMessages).toHaveBeenCalledWith({
      pool: expect.anything(),
      projectId: PROJECT_A,
      userId: 'member-1',
      role: 'TEAM_MEMBER',
      limit: 1,
    })
  })

  it('uses PostgreSQL authorization when the project flag is enabled', async () => {
    process.env.POSTGRES_PROJECTS_ENABLED = 'true'

    const client = connectClient(tokenFor())
    await waitForEvent(client, 'connect')

    const result = await joinProject(client, PROJECT_A)

    expect(result).toMatchObject({ ok: true, projectId: PROJECT_A })
    expect(mocks.listPostgresProjectMessages).toHaveBeenCalledWith({
      pool: expect.anything(),
      projectId: PROJECT_A,
      userId: 'member-1',
      role: 'TEAM_MEMBER',
      limit: 1,
    })
    expect(mocks.listProjectMessages).not.toHaveBeenCalled()
  })
})
