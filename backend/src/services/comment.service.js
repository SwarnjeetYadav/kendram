import mongoose from 'mongoose'
import Task from '../models/Task.js'
import Project from '../models/Project.js'
import ProjectMember from '../models/ProjectMember.js'
import Comment from '../models/Comment.js'
import ActivityLog from '../models/ActivityLog.js'
import { ApiError } from '../utils/apiError.js'

async function ensureTaskAccess(taskId, userId, role) {
  if (!mongoose.isValidObjectId(taskId)) throw new ApiError(400, 'Invalid task id')

  const task = await Task.findById(taskId).lean()
  if (!task) throw new ApiError(404, 'Task not found')

  if (role === 'ADMINISTRATOR') return task

  const project = await Project.findById(task.projectId).select('ownerId').lean()
  if (!project) throw new ApiError(404, 'Project not found')
  if (String(project.ownerId) === String(userId)) return task

  const member = await ProjectMember.findOne({
    projectId: task.projectId,
    userId,
  }).lean()

  if (!member) throw new ApiError(403, 'You are not a member of this project')
  return task
}

export async function listComments({ taskId, userId, role }) {
  await ensureTaskAccess(taskId, userId, role)

  return Comment.find({ taskId })
    .sort({ createdAt: 1 })
    .populate('userId', 'name email role')
    .lean()
}

export async function addComment({ taskId, userId, role, message }) {
  await ensureTaskAccess(taskId, userId, role)

  const cleanMessage = message?.trim()
  if (!cleanMessage) throw new ApiError(400, 'Comment message is required')
  if (cleanMessage.length > 2000) throw new ApiError(400, 'Comment is too long')

  const comment = await Comment.create({
    taskId,
    userId,
    message: cleanMessage,
  })

  await ActivityLog.create({
    userId,
    action: 'COMMENT_ADDED',
    entityType: 'TASK',
    entityId: taskId,
    metadata: { commentId: comment._id },
  })

  return Comment.findById(comment._id)
    .populate('userId', 'name email role')
    .lean()
}
