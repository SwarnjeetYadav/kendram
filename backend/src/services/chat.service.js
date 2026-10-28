import mongoose from 'mongoose'
import Project from '../models/Project.js'
import ProjectMember from '../models/ProjectMember.js'
import ProjectMessage from '../models/ProjectMessage.js'
import Task from '../models/Task.js'
import ActivityLog from '../models/ActivityLog.js'
import { createNotification } from './notification.service.js'
import { ApiError } from '../utils/apiError.js'

async function ensureProjectMember(projectId, userId, role) {
  if (!mongoose.isValidObjectId(projectId)) throw new ApiError(400, 'Invalid project id')

  if (role === 'ADMINISTRATOR') {
    const exists = await Project.exists({ _id: projectId })
    if (!exists) throw new ApiError(404, 'Project not found')
    return true
  }

  const [member, ownerProject] = await Promise.all([
    ProjectMember.exists({ projectId, userId }),
    Project.findOne({ _id: projectId, ownerId: userId }).select('_id name').lean(),
  ])

  if (!member && !ownerProject) throw new ApiError(403, 'You are not a member of this project')
  return ownerProject || true
}

async function validateContext({ projectId, userId, replyToId, taskId, mentions }) {
  if (replyToId) {
    if (!mongoose.isValidObjectId(replyToId)) throw new ApiError(400, 'Invalid reply message id')
    const reply = await ProjectMessage.findOne({ _id: replyToId, projectId }).lean()
    if (!reply) throw new ApiError(422, 'Reply target does not belong to this project')
  }

  if (taskId) {
    if (!mongoose.isValidObjectId(taskId)) throw new ApiError(400, 'Invalid task id')
    const task = await Task.findOne({ _id: taskId, projectId }).lean()
    if (!task) throw new ApiError(422, 'Task context does not belong to this project')
  }

  const memberIds = await ProjectMember.find({ projectId }).distinct('userId')
  const validMentionIds = (mentions || [])
    .filter((id) => mongoose.isValidObjectId(id))
    .map(String)
    .filter((id, index, list) => list.indexOf(id) === index)
    .filter((id) => memberIds.some((memberId) => String(memberId) === id))
    .slice(0, 10)

  return validMentionIds
}

export async function listProjectMessages({ projectId, userId, role, limit = 60 }) {
  await ensureProjectMember(projectId, userId, role)
  const safeLimit = Math.min(Math.max(Number(limit) || 60, 1), 60)

  return ProjectMessage.find({ projectId })
    .select('projectId userId message createdAt replyToId taskId mentions reactions')
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .populate('userId', 'name email role')
    .populate('replyToId', 'userId message createdAt')
    .populate('mentions', 'name email')
    .populate('taskId', 'title status priority')
    .lean()
    .then((messages) => messages.reverse())
}

export async function sendProjectMessage({ projectId, userId, role, message, replyToId = null, taskId = null, mentions = [] }) {
  const access = await ensureProjectMember(projectId, userId, role)
  const cleanMessage = message?.trim()
  if (!cleanMessage) throw new ApiError(400, 'Chat message is required')
  if (cleanMessage.length > 2000) throw new ApiError(400, 'Chat message is too long')

  const hasContext = Boolean(replyToId || taskId || (mentions && mentions.length))
  const validMentions = hasContext
    ? await validateContext({ projectId, userId, replyToId, taskId, mentions })
    : []

  const created = await ProjectMessage.create({
    projectId,
    userId,
    message: cleanMessage,
    replyToId: replyToId || null,
    taskId: taskId || null,
    mentions: validMentions,
    reactions: [],
  })

  // Return the message immediately; secondary audit/notification work is intentionally non-blocking.
  setImmediate(async () => {
    try {
      const project = access?._id && access?.name ? access : await Project.findById(projectId).select('_id name').lean()
      await ActivityLog.create({
        userId,
        action: 'PROJECT_CHAT_MESSAGE',
        entityType: 'PROJECT',
        entityId: projectId,
        metadata: { messageId: created._id, taskId: taskId || null, replyToId: replyToId || null, mentions: validMentions },
      })

      if (validMentions.length && project?.name) {
        const recipients = validMentions.filter((id) => String(id) !== String(userId))
        await Promise.all(recipients.map((recipientId) => createNotification({
          userId: recipientId,
          type: 'PROJECT_CHAT_MENTION',
          message: 'You were mentioned in ' + project.name + ' team chat.',
          entityId: projectId,
        })))
      }
    } catch (error) {
      console.error('Async project chat side-effect failed', error)
    }
  })

  return ProjectMessage.findById(created._id)
    .populate('userId', 'name email role')
    .populate('replyToId', 'userId message createdAt')
    .populate('mentions', 'name email')
    .populate('taskId', 'title status priority')
    .lean()
}

export async function toggleProjectMessageReaction({ projectId, messageId, userId, role, emoji }) {
  await ensureProjectMember(projectId, userId, role)
  if (!mongoose.isValidObjectId(messageId)) throw new ApiError(400, 'Invalid message id')
  if (!['👍', '❤️', '✅', '👀', '🚀'].includes(emoji)) throw new ApiError(400, 'Unsupported reaction')

  const message = await ProjectMessage.findOne({ _id: messageId, projectId })
  if (!message) throw new ApiError(404, 'Message not found')

  const existingIndex = message.reactions.findIndex((item) => String(item.userId) === String(userId) && item.emoji === emoji)
  if (existingIndex >= 0) message.reactions.splice(existingIndex, 1)
  else {
    message.reactions.push({ userId, emoji })
  }

  await message.save()
  return ProjectMessage.findById(message._id)
    .populate('userId', 'name email role')
    .populate('replyToId', 'userId message createdAt')
    .populate('mentions', 'name email')
    .populate('taskId', 'title status priority')
    .lean()
}
