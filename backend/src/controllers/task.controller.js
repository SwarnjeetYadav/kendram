import { asyncHandler } from '../utils/asyncHandler.js'
import ActivityLog from '../models/ActivityLog.js'
import Comment from '../models/Comment.js'
import { createTask, listTasks, updateTask, getAssignmentSuggestions } from '../services/task.service.js'
import { ensureTaskAccess } from '../services/dependency.service.js'

function formatActivity(item) {
  const map = {
    TASK_CREATED: 'created the task',
    TASK_UPDATED: 'updated the task',
    TASK_STATUS_CHANGED: 'changed the task status',
    TASK_PRIORITY_CHANGED: 'changed the task priority',
    TASK_ASSIGNEE_CHANGED: 'changed the task assignee',
    TASK_DUE_DATE_CHANGED: 'changed the due date',
    TASK_DEPENDENCY_ADDED: 'added a dependency',
    TASK_DEPENDENCY_REMOVED: 'removed a dependency',
    COMMENT_ADDED: 'commented on the task',
  }
  return map[item.action] || item.action.replaceAll('_', ' ').toLowerCase()
}

export const create = asyncHandler(async (req, res) => {
  const task = await createTask({
    userId: req.user.id,
    role: req.user.role,
    projectId: req.params.projectId,
    payload: req.body,
  })
  res.status(201).json({ success: true, data: task })
})

export const list = asyncHandler(async (req, res) => {
  const result = await listTasks({
    userId: req.user.id,
    role: req.user.role,
    projectId: req.params.projectId,
    query: req.query,
  })
  res.json({ success: true, data: result.tasks, meta: { pagination: result.pagination } })
})

export const update = asyncHandler(async (req, res) => {
  const task = await updateTask({
    userId: req.user.id,
    role: req.user.role,
    taskId: req.params.taskId,
    payload: req.body,
  })
  res.json({ success: true, data: task })
})

export const assignmentSuggestions = asyncHandler(async (req, res) => {
  const data = await getAssignmentSuggestions({
    userId: req.user.id,
    role: req.user.role,
    taskId: req.params.taskId,
  })
  res.json({ success: true, data })
})

export const activity = asyncHandler(async (req, res) => {
  const { task } = await ensureTaskAccess(req.params.taskId, req.user.id, req.user.role)
  const [activities, comments] = await Promise.all([
    ActivityLog.find({ entityId: task._id, entityType: 'TASK' })
      .sort({ createdAt: 1 })
      .limit(100)
      .populate('userId', 'name email role')
      .lean(),
    Comment.find({ taskId: task._id })
      .sort({ createdAt: 1 })
      .limit(100)
      .populate('userId', 'name email role')
      .lean(),
  ])

  const events = [
    ...activities.map((item) => ({
      id: 'activity-' + item._id,
      type: 'activity',
      action: item.action,
      message: formatActivity(item),
      metadata: item.metadata || {},
      user: item.userId,
      createdAt: item.createdAt,
    })),
    ...comments.map((item) => ({
      id: 'comment-' + item._id,
      type: 'comment',
      action: 'COMMENT_ADDED',
      message: item.message,
      user: item.userId,
      createdAt: item.createdAt,
    })),
  ].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(-150)

  res.json({ success: true, data: events })
})
