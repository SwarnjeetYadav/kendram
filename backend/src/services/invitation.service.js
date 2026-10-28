import mongoose from 'mongoose'
import Invitation from '../models/Invitation.js'
import Project from '../models/Project.js'
import ProjectMember from '../models/ProjectMember.js'
import User from '../models/User.js'
import { createNotification } from './notification.service.js'
import ActivityLog from '../models/ActivityLog.js'
import { ApiError } from '../utils/apiError.js'

const PROJECT_ROLES = ['PROJECT_MANAGER', 'MEMBER', 'VIEWER']

async function ensureManager(projectId, userId, role) {
  if (!mongoose.isValidObjectId(projectId)) throw new ApiError(400, 'Invalid project id')
  const project = await Project.findById(projectId).lean()
  if (!project) throw new ApiError(404, 'Project not found')

  if (role === 'ADMINISTRATOR' || String(project.ownerId) === String(userId)) return project

  const member = await ProjectMember.findOne({ projectId, userId }).lean()
  if (!member || member.projectRole !== 'PROJECT_MANAGER') {
    throw new ApiError(403, 'Only the project owner, administrator, or project manager can manage invitations')
  }
  return project
}

function validateRole(projectRole) {
  if (!PROJECT_ROLES.includes(projectRole)) throw new ApiError(400, 'Invalid project role')
  return projectRole
}

function expiryDate(days = 7) {
  const value = new Date()
  value.setDate(value.getDate() + days)
  return value
}

export async function createInvitation({ projectId, userId, role, invitedUserId, projectRole = 'MEMBER' }) {
  const project = await ensureManager(projectId, userId, role)
  if (!mongoose.isValidObjectId(invitedUserId)) throw new ApiError(400, 'Invalid invited user id')

  const selectedRole = validateRole(projectRole)
  const user = await User.findById(invitedUserId).lean()
  if (!user || user.status !== 'ACTIVE') throw new ApiError(404, 'User not found or inactive')

  if (String(invitedUserId) === String(userId)) {
    throw new ApiError(400, 'You cannot invite yourself to the project')
  }

  const alreadyMember = await ProjectMember.exists({ projectId, userId: invitedUserId })
  if (alreadyMember) throw new ApiError(409, 'User is already a project member')

  await Invitation.updateMany(
    { projectId, invitedUserId, status: 'PENDING', expiresAt: { $lt: new Date() } },
    { $set: { status: 'EXPIRED' } },
  )

  const pending = await Invitation.exists({ projectId, invitedUserId, status: 'PENDING' })
  if (pending) throw new ApiError(409, 'A pending invitation already exists for this user')

  const invitation = await Invitation.create({
    projectId: project._id,
    invitedUserId,
    projectRole: selectedRole,
    expiresAt: expiryDate(7),
    invitedBy: userId,
  })

  await createNotification({
    userId: invitedUserId,
    type: 'PROJECT_INVITATION',
    message: 'You were invited to join "' + project.name + '" as ' + selectedRole.replaceAll('_', ' ').toLowerCase() + '.',
    entityId: project._id,
  })

  await ActivityLog.create({
    userId,
    action: 'PROJECT_INVITATION_SENT',
    entityType: 'PROJECT',
    entityId: project._id,
    metadata: { invitedUserId, projectRole: selectedRole, invitationId: invitation._id },
  })

  return Invitation.findById(invitation._id)
    .populate('invitedUserId', 'name email role')
    .populate('invitedBy', 'name email role')
    .populate('projectId', 'name')
    .lean()
}

export async function listProjectInvitations({ projectId, userId, role }) {
  await ensureManager(projectId, userId, role)

  return Invitation.find({ projectId })
    .sort({ createdAt: -1 })
    .populate('invitedUserId', 'name email role')
    .populate('invitedBy', 'name email role')
    .lean()
}

export async function listMyInvitations({ userId }) {
  await Invitation.updateMany(
    { invitedUserId: userId, status: 'PENDING', expiresAt: { $lt: new Date() } },
    { $set: { status: 'EXPIRED' } },
  )

  return Invitation.find({ invitedUserId: userId, status: 'PENDING' })
    .sort({ expiresAt: 1 })
    .populate('projectId', 'name status')
    .populate('invitedBy', 'name email')
    .lean()
}

export async function respondToInvitation({ invitationId, userId, action }) {
  if (!mongoose.isValidObjectId(invitationId)) throw new ApiError(400, 'Invalid invitation id')
  if (!['ACCEPT', 'DECLINE'].includes(action)) throw new ApiError(400, 'Invalid invitation action')

  const invitation = await Invitation.findOne({ _id: invitationId, invitedUserId: userId })
  if (!invitation) throw new ApiError(404, 'Invitation not found')

  if (invitation.status !== 'PENDING') throw new ApiError(409, 'Invitation is no longer pending')
  if (invitation.expiresAt < new Date()) {
    invitation.status = 'EXPIRED'
    await invitation.save()
    throw new ApiError(409, 'Invitation has expired')
  }

  if (action === 'DECLINE') {
    invitation.status = 'DECLINED'
    await invitation.save()
    await ActivityLog.create({
      userId,
      action: 'PROJECT_INVITATION_DECLINED',
      entityType: 'PROJECT',
      entityId: invitation.projectId,
      metadata: { invitationId: invitation._id },
    })
    return invitation.toObject()
  }

  const existing = await ProjectMember.exists({ projectId: invitation.projectId, userId })
  if (existing) {
    invitation.status = 'ACCEPTED'
    await invitation.save()
    return invitation.toObject()
  }

  await ProjectMember.create({
    projectId: invitation.projectId,
    userId,
    projectRole: invitation.projectRole,
  })

  invitation.status = 'ACCEPTED'
  await invitation.save()

  await ActivityLog.create({
    userId,
    action: 'PROJECT_INVITATION_ACCEPTED',
    entityType: 'PROJECT',
    entityId: invitation.projectId,
    metadata: { invitationId: invitation._id, projectRole: invitation.projectRole },
  })

  await createNotification({
    userId: invitation.invitedBy,
    type: 'PROJECT_INVITATION_ACCEPTED',
    message: 'Your project invitation was accepted.',
    entityId: invitation.projectId,
  })

  return invitation.toObject()
}
