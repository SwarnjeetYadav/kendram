import { createServer } from 'node:http'
import app from './app.js'
import { connectDatabase } from './config/db.js'
import { env } from './config/env.js'
import mongoose from 'mongoose'
import { configureChatRealtime, closeChatRealtime } from './services/chatRealtime.service.js'
import { checkPostgresConnection, closePostgresPool } from './db/postgres.js'

async function start() {
  if (env.persistenceDriver === 'mongo') {
    await connectDatabase()
  } else {
    const connected = await checkPostgresConnection()
    if (!connected) throw new Error('PostgreSQL readiness check failed')
    console.log('PostgreSQL connected; persistence driver is postgres')
  }

  const server = createServer(app)
  configureChatRealtime(server)

  server.listen(env.port, () => {
    console.log(`Kendram API and Socket.IO running on port ${env.port} (persistence: ${env.persistenceDriver})`)
  })

  let shuttingDown = false
  const shutdown = async (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`Received ${signal}; shutting down Kendram API`)
    const forceExit = setTimeout(() => process.exit(1), 10_000)
    forceExit.unref()
    await closeChatRealtime()
    if (env.persistenceDriver === 'mongo') await mongoose.disconnect()
    await closePostgresPool()
    clearTimeout(forceExit)
    process.exit(0)
  }

  process.once('SIGTERM', () => shutdown('SIGTERM'))
  process.once('SIGINT', () => shutdown('SIGINT'))
}

start().catch((error) => {
  console.error('Unable to start Kendram API', error)
  process.exit(1)
})
