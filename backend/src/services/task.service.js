import mongoose from 'mongoose'
import Task from '../models/Task.js'
import Project from '../models/Project.js'
import ProjectMember from '../models/ProjectMember.js'
import ActivityLog from '../models/ActivityLog.js'
import { createNotification } from './notification.service.js'
import { ApiError } from '../utils/apiError.js'
import { isValidPriority, isValidStatus } from '../utils/taskRules.js'
import { suggestAssignee, suggestAssignees } from './assignment.service.js'
import TaskDependency from '../models/TaskDependency.js'
import { getBlockingPredecessors, notifySuccessorsIfUnblocked } from './dependency.service.js'

export async function ensureProjectAccess(projectId, userId, role) {
  if (!mongoose.isValidObjectId(projectId)) throw new ApiError(400, 'Invalid project id')
  const project = await Project.findById(projectId)
  if (!project) throw new ApiError(404, 'Project not found')
  if (role === 'ADMINISTRATOR' || String(project.ownerId) === String(userId)) return { project, member: null }
  const member = await ProjectMember.findOne({ projectId, userId }).lean()
  if (!member) throw new ApiError(403, 'You are not a member of this project')
  return { project, member }
}

function parseEstimate(value) {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 5 || parsed > 43200) throw new ApiError(400, 'Estimate must be between 5 and 43200 minutes')
  return parsed
}

function parseLabels(value, { optional = true } = {}) {
  if (value === undefined && optional) return undefined
  if (value === null) return []
  if (!Array.isArray(value)) throw new ApiError(400, 'Labels must be an array of strings')
  if (value.length > 20 || value.some((label) => typeof label !== 'string' || !label.trim() || label.trim().length > 32)) {
    throw new ApiError(400, 'Provide at most 20 non-empty labels of 32 characters or fewer')
  }
  const labels = value.map((label) => label.trim())
  if (new Set(labels.map((label) => label.toLowerCase())).size !== labels.length) throw new ApiError(400, 'Labels must be unique')
  return labels
}

function parseDate(value, fieldName) {
  if (value === undefined || value === null || value === '') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new ApiError(400, `Invalid ${fieldName}`)
  return date
}

export async function createTask({ userId, role, projectId, payload }) {
  const access = await ensureProjectAccess(projectId, userId, role)
  const project = access.project
  if (access.member?.projectRole === 'VIEWER') throw new ApiError(403, 'Viewers have read-only project access')

  if (payload?.title !== undefined && typeof payload.title !== 'string') throw new ApiError(400, 'Task title must be a string')
  const title = payload?.title?.trim()
  if (!title) throw new ApiError(400, 'Task title is required')
  if (payload.description !== undefined && typeof payload.description !== 'string') throw new ApiError(400, 'Description must be a string')
  if ((payload.description || '').length > 2000) throw new ApiError(400, 'Description is too long')
  if (title.length > 180) throw new ApiError(400, 'Task title is too long')
  const priority = payload.priority || 'MEDIUM'
  if (!isValidPriority(priority)) throw new ApiError(400, 'Invalid task priority')
  const dueDate = parseDate(payload.dueDate, 'due date')
  const estimateMinutes = parseEstimate(payload.estimateMinutes)
  const labels = parseLabels(payload.labels) ?? []
  const members = await ProjectMember.find({ projectId }).select('userId projectRole').lean()
  const memberRoles = new Map(members.map((member) => [String(member.userId), member.projectRole || 'MEMBER']))
  let assigneeId = payload.assigneeId || null

  if (assigneeId && !mongoose.isValidObjectId(assigneeId)) throw new ApiError(400, 'Invalid assignee id')
  if (assigneeId && !memberRoles.has(String(assigneeId))) throw new ApiError(422, 'Assignee is not a member of this project')
  if (assigneeId && memberRoles.get(String(assigneeId)) === 'VIEWER') throw new ApiError(422, 'Viewers cannot be assigned tasks')
  if (!assigneeId) assigneeId = await suggestAssignee(projectId, { priority, dueDate, estimateMinutes })

  const task = await Task.create({
    projectId: project._id, title, description: payload.description?.trim() || '',
    priority, status: 'TODO', assigneeId, dueDate, estimateMinutes, labels, createdBy: userId,
  })
  await ActivityLog.create({
    userId, action: 'TASK_CREATED', entityType: 'TASK', entityId: task._id,
    metadata: { projectId: project._id, assigneeId, priority, dueDate, estimateMinutes, labels },
  })
  if (assigneeId) {
    await createNotification({ userId: assigneeId, type: 'TASK_ASSIGNED', message: 'A new task was assigned to you: ' + task.title, entityId: task._id })
  }
  return task
}

export async function getAssignmentSuggestions({ userId, role, taskId }) {
  if (!mongoose.isValidObjectId(taskId)) throw new ApiError(400, 'Invalid task id')
  const task = await Task.findById(taskId).lean()
  if (!task) throw new ApiError(404, 'Task not found')
  await ensureProjectAccess(task.projectId, userId, role)
  return suggestAssignees({ projectId: task.projectId, priority: task.priority, dueDate: task.dueDate, estimateMinutes: task.estimateMinutes })
}

export async function listTasks({ userId, role, projectId, query = {} }) {
  await ensureProjectAccess(projectId, userId, role)
  const page = query.page === undefined ? 1 : Number(query.page)
  const limit = query.limit === undefined ? 100 : Number(query.limit)
  if (!Number.isInteger(page) || page < 1) throw new ApiError(400, 'page must be a positive integer')
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, 'limit must be an integer between 1 and 100')

  const filter = { projectId }
  if (query.status) {
    if (!isValidStatus(query.status)) throw new ApiError(400, 'Invalid task status filter')
    filter.status = query.status
  }
  if (query.priority) {
    if (!isValidPriority(query.priority)) throw new ApiError(400, 'Invalid task priority filter')
    filter.priority = query.priority
  }
  if (query.assigneeId !== undefined) {
    if (query.assigneeId !== 'unassigned' && !mongoose.isValidObjectId(query.assigneeId)) throw new ApiError(400, 'Invalid assigneeId filter')
    filter.assigneeId = query.assigneeId === 'unassigned' ? null : query.assigneeId
  }
  if (query.label !== undefined) {
    const label = String(query.label).trim()
    if (!label || label.length > 32) throw new ApiError(400, 'label must be 1-32 characters')
    filter.labels = label
  }
  if (query.overdue !== undefined && !['true', 'false', true, false].includes(query.overdue)) throw new ApiError(400, 'overdue must be true or false')
  const dueDateFrom = parseDate(query.dueDateFrom, 'dueDateFrom')
  const dueDateTo = parseDate(query.dueDateTo, 'dueDateTo')
  if (dueDateFrom && dueDateTo && dueDateFrom > dueDateTo) throw new ApiError(400, 'dueDateFrom must be before or equal to dueDateTo')
  if (query.overdue === 'true') filter.dueDate = { $lt: new Date(), $ne: null, $exists: true, ...(filter.dueDate || {}) }
  else if (dueDateFrom || dueDateTo) filter.dueDate = { ...(dueDateFrom ? { $gte: dueDateFrom } : {}), ...(dueDateTo ? { $lte: dueDateTo } : {}) }

  const [tasks, total, dependencies] = await Promise.all([
    Task.find(filter).sort({ dueDate: 1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('assigneeId', 'name email role').lean(),
    Task.countDocuments(filter),
    TaskDependency.find({ projectId }).select('predecessorTaskId successorTaskId').lean(),
  ])
  const dependencyMap = new Map()
  for (const edge of dependencies) {
    const predecessor = String(edge.predecessorTaskId)
    const successor = String(edge.successorTaskId)
    const predecessorEntry = dependencyMap.get(predecessor) || { blockedBy: [], blocks: [] }
    const successorEntry = dependencyMap.get(successor) || { blockedBy: [], blocks: [] }
    predecessorEntry.blocks.push(successor)
    successorEntry.blockedBy.push(predecessor)
    dependencyMap.set(predecessor, predecessorEntry)
    dependencyMap.set(successor, successorEntry)
  }
  const data = tasks.map((task) => {
    const dependency = dependencyMap.get(String(task._id)) || { blockedBy: [], blocks: [] }
    return { ...task, dependencyCount: dependency.blockedBy.length + dependency.blocks.length, blockedByCount: dependency.blockedBy.length, blockingCount: dependency.blocks.length, blockedByTaskIds: dependency.blockedBy, blockingTaskIds: dependency.blocks, hasBlockingDependencies: dependency.blockedBy.length > 0 }
  })
  return { tasks: data, pagination: { page, limit, total, pages: Math.ceil(total / limit), hasNextPage: page * limit < total, hasPreviousPage: page > 1 } }
}

export async function updateTask({ userId, role, taskId, payload }) {
  if (!mongoose.isValidObjectId(taskId)) throw new ApiError(400, 'Invalid task id')
  const task = await Task.findById(taskId)
  if (!task) throw new ApiError(404, 'Task not found')
  const access = await ensureProjectAccess(task.projectId, userId, role)
  if (access.member?.projectRole === 'VIEWER') throw new ApiError(403, 'Viewers have read-only project access')
  if (payload.status && !isValidStatus(payload.status)) throw new ApiError(400, 'Invalid task status')
  if (payload.priority && !isValidPriority(payload.priority)) throw new ApiError(400, 'Invalid task priority')
  if (payload.title !== undefined && (typeof payload.title !== 'string' || !payload.title.trim())) throw new ApiError(400, 'Task title cannot be empty')
  if (payload.version !== undefined && (!Number.isInteger(payload.version) || payload.version < 1)) throw new ApiError(400, 'version must be a positive integer')
  const expectedVersion = payload.version ?? task.version ?? 1
  const labels = parseLabels(payload.labels)
  const estimateMinutes = payload.estimateMinutes !== undefined ? parseEstimate(payload.estimateMinutes) : undefined

  if (payload.assigneeId) {
    if (!mongoose.isValidObjectId(payload.assigneeId)) throw new ApiError(400, 'Invalid assignee id')
    const member = await ProjectMember.findOne({ projectId: task.projectId, userId: payload.assigneeId }).lean()
    if (!member) throw new ApiError(422, 'Assignee is not a member of this project')
    if (member.projectRole === 'VIEWER') throw new ApiError(422, 'Viewers cannot be assigned tasks')
  }
  if (payload.status && ['IN_PROGRESS', 'REVIEW', 'COMPLETED'].includes(payload.status)) {
    const blockers = await getBlockingPredecessors(task._id)
    if (blockers.length) throw new ApiError(409, 'Task is blocked by: ' + blockers.slice(0, 3).map((item) => item.title).join(', '))
  }

  const changes = {}
  const next = {
    title: task.title, description: task.description, status: task.status, priority: task.priority,
    assigneeId: task.assigneeId, dueDate: task.dueDate, estimateMinutes: task.estimateMinutes,
    labels: task.labels || [], startedAt: task.startedAt, completedAt: task.completedAt,
  }
  if (payload.title !== undefined) next.title = payload.title.trim()
  if (payload.description !== undefined) {
    if (typeof payload.description !== 'string') throw new ApiError(400, 'description must be a string')
    next.description = payload.description.trim()
    if (next.description.length > 2000) throw new ApiError(400, 'Description is too long')
  }
  if (payload.status) next.status = payload.status
  if (payload.priority) next.priority = payload.priority
  if (payload.assigneeId !== undefined) next.assigneeId = payload.assigneeId || null
  if (estimateMinutes !== undefined) next.estimateMinutes = estimateMinutes
  if (labels !== undefined) next.labels = labels
  if (payload.dueDate !== undefined) next.dueDate = parseDate(payload.dueDate, 'due date')

  for (const field of ['title', 'description', 'status', 'priority', 'assigneeId', 'estimateMinutes', 'labels']) {
    const before = field === 'assigneeId' ? String(task[field] || '') : JSON.stringify(task[field] ?? null)
    const after = field === 'assigneeId' ? String(next[field] || '') : JSON.stringify(next[field] ?? null)
    if (before !== after) changes[field] = { from: task[field] ?? null, to: next[field] ?? null }
  }
  const beforeDue = task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : null
  const afterDue = next.dueDate ? new Date(next.dueDate).toISOString().slice(0, 10) : null
  if (beforeDue !== afterDue) changes.dueDate = { from: task.dueDate ?? null, to: next.dueDate }
  if (next.status === 'IN_PROGRESS' && !next.startedAt) next.startedAt = new Date()
  if (next.status === 'COMPLETED') {
    if (!next.startedAt) next.startedAt = task.createdAt || new Date()
    next.completedAt = new Date()
  } else if (payload.status && payload.status !== 'COMPLETED') next.completedAt = null

  // Compare-and-swap: concurrent updates with the same version cannot both succeed.
  const versionFilter = expectedVersion === 1
    ? { $or: [{ version: 1 }, { version: { $exists: false } }] }
    : { version: expectedVersion }
  const result = await Task.updateOne({ _id: task._id, ...versionFilter }, {
    $set: { ...next, updatedAt: new Date() }, $inc: { version: 1 },
  })
  if (result.modifiedCount !== 1) throw new ApiError(409, 'Task was changed by another user. Refresh the task and retry with the latest version.')

  for (const [field, change] of Object.entries(changes)) {
    const action = field === 'status' ? 'TASK_STATUS_CHANGED' : field === 'priority' ? 'TASK_PRIORITY_CHANGED' : field === 'assigneeId' ? 'TASK_ASSIGNEE_CHANGED' : field === 'dueDate' ? 'TASK_DUE_DATE_CHANGED' : 'TASK_UPDATED'
    await ActivityLog.create({ userId, action, entityType: 'TASK', entityId: task._id, metadata: { field, ...change, version: expectedVersion + 1 } })
  }
  if (changes.assigneeId?.to) await createNotification({ userId: changes.assigneeId.to, type: 'TASK_ASSIGNED', message: 'You are now assigned to: ' + next.title, entityId: task._id })
  if (changes.status?.to === 'COMPLETED') await notifySuccessorsIfUnblocked(task._id)
  return Task.findById(task._id).populate('assigneeId', 'name email role')
}
