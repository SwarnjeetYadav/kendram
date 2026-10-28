import jwt from 'jsonwebtoken'
import { Server } from 'socket.io'
import User from '../models/User.js'
import { env } from '../config/env.js'
import { listProjectMessages } from './chat.service.js'
import { getPostgresPool } from '../db/postgres.js'
import { listPostgresProjectMessages } from './postgresChat.service.js'
import { postgresAuthUserById } from './postgresAuth.service.js'

let io

export function configureChatRealtime(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin(origin, callback) {
        if (!origin || env.clientOrigins.includes(origin)) return callback(null, true)
        return callback(new Error('Origin is not allowed by CORS'))
      },
      methods: ['GET', 'POST'],
      credentials: false,
    },
    transports: ['websocket', 'polling'],
  })

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token
      if (typeof token !== 'string' || !token) return next(new Error('Authentication required'))
      const payload = jwt.verify(token, env.jwtSecret)
      const user = process.env.POSTGRES_AUTH_ENABLED === 'true'
        ? await postgresAuthUserById(payload.sub)
        : await User.findById(payload.sub).lean()
      if (!user || user.status !== 'ACTIVE') return next(new Error('User account is not active'))
      socket.data.user = { id: String(user.legacy_mongo_id || user._id || user.id), name: user.name, email: user.email, role: user.role }
      next()
    } catch {
      next(new Error('Invalid or expired access token'))
    }
  })

  io.on('connection', (socket) => {
    socket.on('project:join', async (payload, acknowledge) => {
      const reply = typeof acknowledge === 'function' ? acknowledge : () => {}
      const projectId = typeof payload?.projectId === 'string' ? payload.projectId : ''
      if (!projectId) return reply({ ok: false, message: 'Project id is required' })

      try {
        if (process.env.POSTGRES_PROJECTS_ENABLED === 'true') {
          await listPostgresProjectMessages({
            pool: getPostgresPool(), projectId,
            userId: socket.data.user.id, role: socket.data.user.role, limit: 1,
          })
        } else {
          await listProjectMessages({
            projectId, userId: socket.data.user.id,
            role: socket.data.user.role, limit: 1,
          })
        }
        await socket.join(projectRoom(projectId))
        reply({ ok: true, projectId })
      } catch (error) {
        reply({ ok: false, message: error.statusCode === 403 ? 'You are not a member of this project' : 'Unable to join project chat' })
      }
    })

    socket.on('project:leave', (payload) => {
      if (typeof payload?.projectId === 'string') socket.leave(projectRoom(payload.projectId))
    })
  })

  return io
}

function projectRoom(projectId) {
  return 'project-chat:' + String(projectId)
}

export async function revokeProjectChatAccess(projectId, userId) {
  if (!io || !projectId || !userId) return 0

  const sockets = await io.in(projectRoom(projectId)).fetchSockets()
  let revoked = 0
  for (const socket of sockets) {
    if (String(socket.data.user?.id) !== String(userId)) continue
    await socket.leave(projectRoom(projectId))
    revoked += 1
  }
  return revoked
}

export function publishProjectChatMessage(projectId, message) {
  if (!io || !message) return
  io.to(projectRoom(projectId)).emit('chat:message', message)
}

export function publishProjectChatReaction(projectId, message) {
  if (!io || !message) return
  io.to(projectRoom(projectId)).emit('chat:reaction', message)
}

export async function closeChatRealtime() {
  if (!io) return
  const current = io
  io = undefined
  await new Promise((resolve) => current.close(resolve))
}
