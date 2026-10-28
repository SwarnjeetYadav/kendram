import mongoose from 'mongoose'
import { env } from './env.js'

export async function connectDatabase() {
  if (env.persistenceDriver !== 'mongo') {
    throw new Error('MongoDB connection requested while PERSISTENCE_DRIVER is not "mongo"')
  }
  mongoose.set('strictQuery', true)
  await mongoose.connect(env.mongoUri)
  console.log('MongoDB connected')
}
