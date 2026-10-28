import mongoose from 'mongoose'
import Project from '../models/Project.js'
import ProjectMember from '../models/ProjectMember.js'
import Task from '../models/Task.js'
import User from '../models/User.js'
import { ApiError } from '../utils/apiError.js'

function escapeRegex(value) {
  return value.replace(/[.*+?^()|[\]\\]/g, '\\$&')
}

export async function searchWorkspace({ userId, role, query = '', scope = 'workspace' }) {
  const term = query.trim()
  if (term.length < 2) return { projects: [], tasks: [], members: [] }
  if (!mongoose.isValidObjectId(userId)) throw new ApiError(401, 'Invalid user')

  let projectIds
  if (role === 'ADMINISTRATOR') {
    projectIds = await Project.find().distinct('_id')
  } else {
    projectIds = await ProjectMember.find({ userId }).distinct('projectId')
    const owned = await Project.find({ ownerId: userId }).distinct('_id')
    projectIds = [...new Set([...projectIds.map(String), ...owned.map(String)])]
  }

  const matcher = new RegExp(escapeRegex(term), 'i')
  const projectFilter = scope === 'project' && mongoose.isValidObjectId(query)
    ? { _id: query }
    : { _id: { $in: projectIds }, name: matcher }

  const projects = await Project.find(projectFilter)
    .select('name status dueDate ownerId')
    .sort({ updatedAt: -1 })
    .limit(8)
    .lean()

  const taskFilter = { projectId: { $in: projectIds }, $or: [{ title: matcher }, { description: matcher }] }
  const tasks = await Task.find(taskFilter)
    .select('title projectId status priority dueDate assigneeId')
    .populate('assigneeId', 'name')
    .sort({ updatedAt: -1 })
    .limit(12)
    .lean()

  const memberIds = await ProjectMember.find({ projectId: { $in: projectIds } }).distinct('userId')
  const members = await User.find({
    _id: { $in: memberIds },
    status: 'ACTIVE',
    $or: [{ name: matcher }, { email: matcher }],
  })
    .select('name email role')
    .sort({ name: 1 })
    .limit(8)
    .lean()

  const accessibleProjects = await Project.find({ _id: { $in: projectIds } }).select('name').lean()
  const projectNameMap = new Map(accessibleProjects.map((project) => [String(project._id), project.name]))
  return {
    projects,
    tasks: tasks.map((task) => ({ ...task, projectName: projectNameMap.get(String(task.projectId)) || 'Project' })),
    members,
  }
}
