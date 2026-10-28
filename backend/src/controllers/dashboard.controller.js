import { asyncHandler } from '../utils/asyncHandler.js'
import Project from '../models/Project.js'
import ProjectMember from '../models/ProjectMember.js'
import Task from '../models/Task.js'

export const summary = asyncHandler(async (req, res) => {
  const projectIds = req.user.role === 'ADMINISTRATOR'
    ? (await Project.find().select('_id').lean()).map((project) => project._id)
    : [
        ...(await Project.find({ ownerId: req.user.id }).select('_id').lean()).map((project) => project._id),
        ...(await ProjectMember.find({ userId: req.user.id }).select('projectId').lean()).map((item) => item.projectId),
      ]

  const uniqueProjectIds = [...new Map(projectIds.map((id) => [String(id), id])).values()]

  const [activeProjects, openTasks, completedTasks, overdueTasks] = await Promise.all([
    Project.countDocuments({ _id: { $in: uniqueProjectIds }, status: { $in: ['PLANNING', 'ACTIVE'] } }),
    Task.countDocuments({ projectId: { $in: uniqueProjectIds }, status: { $ne: 'COMPLETED' } }),
    Task.countDocuments({
      projectId: { $in: uniqueProjectIds },
      status: 'COMPLETED',
    }),
    Task.countDocuments({
      projectId: { $in: uniqueProjectIds },
      status: { $ne: 'COMPLETED' },
      dueDate: { $lt: new Date(), $ne: null },
    }),
  ])

  res.json({
    success: true,
    data: { activeProjects, openTasks, completedTasks, overdueTasks },
  })
})
