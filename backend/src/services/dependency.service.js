import mongoose from 'mongoose'
import Task from '../models/Task.js'
import TaskDependency from '../models/TaskDependency.js'
import Project from '../models/Project.js'
import ProjectMember from '../models/ProjectMember.js'
import ActivityLog from '../models/ActivityLog.js'
import { createNotification } from './notification.service.js'
import { ApiError } from '../utils/apiError.js'

export async function ensureTaskAccess(taskId, userId, role) {
  if (!mongoose.isValidObjectId(taskId)) throw new ApiError(400, 'Invalid task id')

  const task = await Task.findById(taskId).lean()
  if (!task) throw new ApiError(404, 'Task not found')

  const project = await Project.findById(task.projectId).lean()
  if (!project) throw new ApiError(404, 'Project not found')

  if (role === 'ADMINISTRATOR' || String(project.ownerId) === String(userId)) {
    return { task, project, member: null }
  }

  const member = await ProjectMember.findOne({ projectId: task.projectId, userId }).lean()
  if (!member) throw new ApiError(403, 'You are not a member of this project')

  return { task, project, member }
}

export function graphContainsPath(graph, start, target, limit = 1000) {
  const queue = [String(start)]
  const visited = new Set(queue)

  while (queue.length) {
    const current = queue.shift()
    if (current === String(target)) return true

    for (const next of graph.get(current) || []) {
      const value = String(next)
      if (visited.has(value)) continue
      visited.add(value)
      queue.push(value)
      if (visited.size > limit) return true
    }
  }

  return false
}

export async function wouldCreateCycle({ projectId, predecessorTaskId, successorTaskId }) {
  const dependencies = await TaskDependency.find({ projectId })
    .select('predecessorTaskId successorTaskId')
    .lean()

  const graph = new Map()
  for (const edge of dependencies) {
    const from = String(edge.predecessorTaskId)
    const to = String(edge.successorTaskId)
    if (!graph.has(from)) graph.set(from, [])
    graph.get(from).push(to)
  }

  return graphContainsPath(graph, successorTaskId, predecessorTaskId)
}

export async function listDependencies({ taskId, userId, role }) {
  const { task } = await ensureTaskAccess(taskId, userId, role)

  const dependencies = await TaskDependency.find({
    projectId: task.projectId,
    $or: [{ predecessorTaskId: task._id }, { successorTaskId: task._id }],
  })
    .populate('predecessorTaskId', 'title status priority assigneeId dueDate')
    .populate('successorTaskId', 'title status priority assigneeId dueDate')
    .sort({ createdAt: 1 })
    .lean()

  return dependencies
}

export async function getBlockingPredecessors(taskId) {
  if (!mongoose.isValidObjectId(taskId)) return []
  const edges = await TaskDependency.find({ successorTaskId: taskId }).select('predecessorTaskId').lean()
  if (!edges.length) return []

  const predecessorIds = edges.map((edge) => edge.predecessorTaskId)
  return Task.find({
    _id: { $in: predecessorIds },
    status: { $ne: 'COMPLETED' },
  })
    .select('_id title status priority dueDate assigneeId')
    .lean()
}

export async function addDependency({ taskId, predecessorTaskId, userId, role }) {
  const { task: successor, project } = await ensureTaskAccess(taskId, userId, role)

  if (!mongoose.isValidObjectId(predecessorTaskId)) throw new ApiError(400, 'Invalid predecessor task id')
  if (String(successor._id) === String(predecessorTaskId)) {
    throw new ApiError(400, 'A task cannot depend on itself')
  }

  const predecessor = await Task.findById(predecessorTaskId).lean()
  if (!predecessor) throw new ApiError(404, 'Predecessor task not found')
  if (String(predecessor.projectId) !== String(project._id)) {
    throw new ApiError(422, 'Both tasks must belong to the same project')
  }

  const duplicate = await TaskDependency.exists({
    projectId: project._id,
    predecessorTaskId: predecessor._id,
    successorTaskId: successor._id,
  })
  if (duplicate) throw new ApiError(409, 'This dependency already exists')

  if (await wouldCreateCycle({
    projectId: project._id,
    predecessorTaskId: predecessor._id,
    successorTaskId: successor._id,
  })) {
    throw new ApiError(422, 'Dependency would create a circular task chain')
  }

  const dependency = await TaskDependency.create({
    projectId: project._id,
    predecessorTaskId: predecessor._id,
    successorTaskId: successor._id,
    createdBy: userId,
  })

  const blocking = predecessor.status !== 'COMPLETED'

  await ActivityLog.create({
    userId,
    action: 'TASK_DEPENDENCY_ADDED',
    entityType: 'TASK',
    entityId: successor._id,
    metadata: {
      predecessorTaskId: predecessor._id,
      successorTaskId: successor._id,
      blocking,
    },
  })

  return TaskDependency.findById(dependency._id)
    .populate('predecessorTaskId', 'title status priority assigneeId dueDate')
    .populate('successorTaskId', 'title status priority assigneeId dueDate')
    .lean()
}

export async function removeDependency({ taskId, dependencyId, userId, role }) {
  const { task } = await ensureTaskAccess(taskId, userId, role)

  if (!mongoose.isValidObjectId(dependencyId)) throw new ApiError(400, 'Invalid dependency id')
  const dependency = await TaskDependency.findOne({ _id: dependencyId, projectId: task.projectId })
  if (!dependency) throw new ApiError(404, 'Task dependency not found')

  await dependency.deleteOne()
  await ActivityLog.create({
    userId,
    action: 'TASK_DEPENDENCY_REMOVED',
    entityType: 'TASK',
    entityId: task._id,
    metadata: {
      predecessorTaskId: dependency.predecessorTaskId,
      successorTaskId: dependency.successorTaskId,
    },
  })

  return { dependencyId }
}

export async function notifySuccessorsIfUnblocked(completedTaskId) {
  if (!mongoose.isValidObjectId(completedTaskId)) return

  const edges = await TaskDependency.find({ predecessorTaskId: completedTaskId }).select('successorTaskId').lean()
  if (!edges.length) return

  for (const edge of edges) {
    const blocking = await getBlockingPredecessors(edge.successorTaskId)
    if (blocking.length) continue

    const successor = await Task.findById(edge.successorTaskId).select('title assigneeId status').lean()
    if (!successor?.assigneeId || successor.status === 'COMPLETED') continue

    await createNotification({
      userId: successor.assigneeId,
      type: 'DEPENDENCY_UNBLOCKED',
      message: 'A blocker is complete. You can now continue: ' + successor.title,
      entityId: successor._id,
    })
  }
}
