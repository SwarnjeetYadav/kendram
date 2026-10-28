import 'dotenv/config'

const persistenceDriver = (process.env.PERSISTENCE_DRIVER || 'mongo').trim().toLowerCase()
if (!['mongo', 'postgres'].includes(persistenceDriver)) {
  throw new Error('PERSISTENCE_DRIVER must be either "mongo" or "postgres"')
}

const mongoUri = process.env.MONGODB_URI?.trim()
const databaseUrl = process.env.DATABASE_URL?.trim()
const jwtSecret = process.env.JWT_SECRET?.trim()
const nodeEnv = process.env.NODE_ENV || 'development'
const clientOrigins = (process.env.CLIENT_ORIGINS || process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

if (persistenceDriver === 'mongo' && !mongoUri) {
  throw new Error('MONGODB_URI is required when PERSISTENCE_DRIVER=mongo')
}
if (persistenceDriver === 'postgres' && !databaseUrl) {
  throw new Error('DATABASE_URL is required when PERSISTENCE_DRIVER=postgres')
}
if (!jwtSecret) throw new Error('JWT_SECRET is required in backend/.env')
if (nodeEnv === 'production' && jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production')
}

const port = Number(process.env.PORT || 5000)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a valid TCP port')
}

const appUrl = (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '')
const resendApiKey = process.env.RESEND_API_KEY?.trim() || ''
const emailFrom = process.env.EMAIL_FROM?.trim() || 'Kendram <onboarding@resend.dev>'
export const env = { port, nodeEnv, persistenceDriver, mongoUri, databaseUrl, jwtSecret, clientOrigins, appUrl, resendApiKey, emailFrom }
