import { asyncHandler } from '../utils/asyncHandler.js'
import { createProject, getProjectForUser, listProjectsForUser } from '../services/project.service.js'

export const create = asyncHandler(async (req, res) => {
  const project = await createProject(req.user.id, req.body)
  res.status(201).json({ success: true, data: project })
})

export const list = asyncHandler(async (req, res) => {
  const projects = await listProjectsForUser(req.user.id, req.user.role)
  res.json({ success: true, data: projects })
})

export const getOne = asyncHandler(async (req, res) => {
  const project = await getProjectForUser(req.params.projectId, req.user.id, req.user.role)
  res.json({ success: true, data: project })
})
