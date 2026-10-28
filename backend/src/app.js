import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import routes from './routes/index.js'
import { env } from './config/env.js'
import { notFound, errorHandler } from './middleware/errorHandler.js'

const app = express()

app.disable('x-powered-by')
app.set('trust proxy', env.nodeEnv === 'production' ? 1 : false)

const allowedOrigins = new Set(env.clientOrigins)

app.use(helmet())

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true)
    return callback(new Error('Origin is not allowed by CORS'))
  },
}))

app.use(express.json({ limit: '1mb' }))

app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint()
  res.on('finish', () => {
    if (env.nodeEnv !== 'test') {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6
      console.info(JSON.stringify({
        type: 'http_request',
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
      }))
    }
  })
  next()
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many authentication attempts. Please try again later.',
  },
})

app.get('/api/v1/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      service: 'anvaya-api',
      status: 'healthy',
      environment: env.nodeEnv,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    },
  })
})

app.use('/api/v1/auth', authLimiter)
app.use('/api/v1', routes)
app.use(notFound)
app.use(errorHandler)

export default app
