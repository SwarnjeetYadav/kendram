import bcrypt from 'bcryptjs'
import { connectDatabase } from '../config/db.js'
import { env } from '../config/env.js'
import User from '../models/User.js'
import Project from '../models/Project.js'
import ProjectMember from '../models/ProjectMember.js'

async function seedDemo() {
  const email = process.env.SEED_MANAGER_EMAIL
  const password = process.env.SEED_MANAGER_PASSWORD

  if (!email || !password) {
    throw new Error('Set SEED_MANAGER_EMAIL and SEED_MANAGER_PASSWORD before running the demo seed')
  }

  if (password.length < 8) {
    throw new Error('SEED_MANAGER_PASSWORD must be at least 8 characters')
  }

  await connectDatabase()

  const passwordHash = await bcrypt.hash(password, 12)
  const manager = await User.findOneAndUpdate(
    { email: email.toLowerCase().trim() },
    {
      name: 'Kendram Demo Manager',
      email: email.toLowerCase().trim(),
      passwordHash,
      role: 'PROJECT_MANAGER',
      status: 'ACTIVE',
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )

  let project = await Project.findOne({ name: 'Kendram Web', ownerId: manager._id })

  if (!project) {
    project = await Project.create({
      name: 'Kendram Web',
      description: 'Demo project created by the controlled local seed process.',
      ownerId: manager._id,
      status: 'ACTIVE',
    })
  }

  await ProjectMember.updateOne(
    { projectId: project._id, userId: manager._id },
    { $setOnInsert: { projectId: project._id, userId: manager._id, projectRole: 'PROJECT_MANAGER' } },
    { upsert: true },
  )

  console.log('Demo manager ready:', manager.email)
  console.log('Demo project ready:', project.name)
  await import('mongoose').then(({ default: mongoose }) => mongoose.connection.close())
}

seedDemo().catch((error) => {
  console.error('Unable to seed demo data', error)
  process.exit(1)
})
