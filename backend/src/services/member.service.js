import mongoose from 'mongoose'
import User from '../models/User.js'
import Project from '../models/Project.js'
import ProjectMember from '../models/ProjectMember.js'
import Task from '../models/Task.js'
import ActivityLog from '../models/ActivityLog.js'
import { createNotification } from './notification.service.js'
import { ApiError } from '../utils/apiError.js'

const PROJECT_ROLES = ['PROJECT_MANAGER', 'MEMBER', 'VIEWER']

function validateProjectRole(projectRole = 'MEMBER') {
  if (!PROJECT_ROLES.includes(projectRole)) {
    throw new ApiError(400, 'Invalid project role')
  }
  return projectRole
}

async function ensureManager(projectId, userId, role) {
  if (!mongoose.isValidObjectId(projectId)) throw new ApiError(400, 'Invalid project id')

  const project = await Project.findById(projectId).lean()
  if (!project) throw new ApiError(404, 'Project not found')

  if (role === 'ADMINISTRATOR' || String(project.ownerId) === String(userId)) {
    return { project, actorMember: null }
  }

  const actorMember = await ProjectMember.findOne({ projectId, userId }).lean()
  if (!actorMember || actorMember.projectRole !== 'PROJECT_MANAGER') {
    throw new ApiError(403, 'Only the project owner, administrator, or project manager can manage this team')
  }

  return { project, actorMember }
}

async function ensureProjectAccess(projectId, userId, role) {
  if (!mongoose.isValidObjectId(projectId)) throw new ApiError(400, 'Invalid project id')

  const project = await Project.findById(projectId).lean()
  if (!project) throw new ApiError(404, 'Project not found')

  if (role === 'ADMINISTRATOR' || String(project.ownerId) === String(userId)) return project

  const member = await ProjectMember.exists({ projectId, userId })
  if (!member) throw new ApiError(403, 'You are not a member of this project')

  return project
}

async function populatedMember(projectId, memberUserId) {
  return ProjectMember.findOne({ projectId, userId: memberUserId })
    .populate('userId', 'name email role status')
    .lean()
}

export async function listMembers(projectId, userId, role) {
  await ensureProjectAccess(projectId, userId, role)

  return ProjectMember.find({ projectId })
    .populate('userId', 'name email role status')
    .sort({ projectRole: 1, createdAt: 1 })
    .lean()
}

export async function searchMemberCandidates(projectId, userId, role, query = '') {
  await ensureManager(projectId, userId, role)

  const term = query.trim()
  if (term.length < 2) return []

  const existingIds = await ProjectMember.find({ projectId }).distinct('userId')
  const safeTerm = term.replace(/[.*+?^()|[\]\\]/g, '\\$&')
  const matcher = new RegExp(safeTerm, 'i')

  return User.find({
    status: 'ACTIVE',
    _id: { $nin: existingIds },
    $or: [{ name: matcher }, { email: matcher }],
  })
    .select('name email role status')
    .sort({ name: 1 })
    .limit(10)
    .lean()
}

export async function addMember(projectId, userId, role, memberUserId, projectRole = 'MEMBER') {
  const { project } = await ensureManager(projectId, userId, role)
  if (!mongoose.isValidObjectId(memberUserId)) throw new ApiError(400, 'Invalid member id')

  const selectedRole = validateProjectRole(projectRole)
  const member = await User.findById(memberUserId).lean()
  if (!member || member.status !== 'ACTIVE') throw new ApiError(404, 'User not found or inactive')

  const alreadyMember = await ProjectMember.exists({ projectId, userId: memberUserId })
  if (alreadyMember) throw new ApiError(409, 'User is already a member of this project')

  await ProjectMember.create({ projectId: project._id, userId: memberUserId, projectRole: selectedRole })

  await createNotification({
    userId: memberUserId,
    type: 'PROJECT_MEMBER_ADDED',
    message: 'You were added to the project "' + project.name + '" with ' + selectedRole.replaceAll('_', ' ').toLowerCase() + ' permissions.',
    entityId: project._id,
  })

  return populatedMember(project._id, memberUserId)
}

export async function updateMemberRole(projectId, memberUserId, userId, role, projectRole) {
  const { project } = await ensureManager(projectId, userId, role)

  if (!mongoose.isValidObjectId(memberUserId)) throw new ApiError(400, 'Invalid member id')
  if (String(project.ownerId) === String(memberUserId)) {
    throw new ApiError(400, 'The project owner always retains owner permissions')
  }

  const selectedRole = validateProjectRole(projectRole)
  const membership = await ProjectMember.findOne({ projectId, userId: memberUserId })
  if (!membership) throw new ApiError(404, 'Project member not found')

  membership.projectRole = selectedRole
  await membership.save()

  await ActivityLog.create({
    userId,
    action: 'PROJECT_MEMBER_ROLE_UPDATED',
    entityType: 'PROJECT',
    entityId: project._id,
    metadata: { memberUserId, projectRole: selectedRole },
  })

  return populatedMember(project._id, memberUserId)
}

export async function removeMember(projectId, memberUserId, userId, role) {
  const { project } = await ensureManager(projectId, userId, role)

  if (!mongoose.isValidObjectId(memberUserId)) throw new ApiError(400, 'Invalid member id')
  if (String(project.ownerId) === String(memberUserId)) {
    throw new ApiError(400, 'The project owner cannot be removed from the project')
  }
  if (String(userId) === String(memberUserId)) {
    throw new ApiError(400, 'A project manager cannot remove themselves')
  }

  const membership = await ProjectMember.findOne({ projectId, userId: memberUserId })
  if (!membership) throw new ApiError(404, 'Project member not found')

  await ProjectMember.deleteOne({ _id: membership._id })
  await Task.updateMany(
    { projectId, assigneeId: memberUserId },
    { $set: { assigneeId: null } },
  )

  await ActivityLog.create({
    userId,
    action: 'PROJECT_MEMBER_REMOVED',
    entityType: 'PROJECT',
    entityId: project._id,
    metadata: { memberUserId },
  })

  return { projectId: project._id, removedUserId: memberUserId }
}
