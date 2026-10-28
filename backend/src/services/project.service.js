import mongoose from 'mongoose'
import Project from '../models/Project.js'
import ProjectMember from '../models/ProjectMember.js'
import { ApiError } from '../utils/apiError.js'

const PROJECT_STATUSES = ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED']

function parseOptionalDate(value, fieldName) {
  if (value === undefined || value === null || value === '') return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new ApiError(400, `Invalid ${fieldName}`)
  return date
}

function validateProjectId(projectId) {
  if (!mongoose.isValidObjectId(projectId)) throw new ApiError(400, 'Invalid project id')
}

export async function ensureProjectAccess(projectId, userId, role) {
  validateProjectId(projectId)

  const project = await Project.findById(projectId).lean()
  if (!project) throw new ApiError(404, 'Project not found')

  if (role === 'ADMINISTRATOR' || String(project.ownerId) === String(userId)) return project

  const member = await ProjectMember.exists({ projectId, userId })
  if (!member) throw new ApiError(403, 'You are not a member of this project')

  return project
}

export async function createProject(userId, payload = {}) {
  const name = payload.name?.trim()
  if (!name) throw new ApiError(400, 'Project name is required')
  if (name.length > 120) throw new ApiError(400, 'Project name is too long')

  const status = payload.status || 'PLANNING'
  if (!PROJECT_STATUSES.includes(status)) throw new ApiError(400, 'Invalid project status')

  const startDate = parseOptionalDate(payload.startDate, 'start date')
  const dueDate = parseOptionalDate(payload.dueDate, 'due date')

  const project = await Project.create({
    name,
    description: payload.description?.trim() || '',
    ownerId: userId,
    startDate,
    dueDate,
    status,
  })

  await ProjectMember.create({ projectId: project._id, userId })
  return project
}

export async function listProjectsForUser(userId, role) {
  if (role === 'ADMINISTRATOR') return Project.find().sort({ createdAt: -1 }).lean()

  const projectIds = await ProjectMember.find({ userId }).distinct('projectId')
  return Project.find({
    $or: [{ ownerId: userId }, { _id: { $in: projectIds } }],
  }).sort({ createdAt: -1 }).lean()
}

export async function getProjectForUser(projectId, userId, role) {
  return ensureProjectAccess(projectId, userId, role)
}
