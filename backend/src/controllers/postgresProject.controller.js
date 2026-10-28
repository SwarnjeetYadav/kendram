import { asyncHandler } from '../utils/asyncHandler.js'
import { getPostgresPool } from '../db/postgres.js'
import {
  createPostgresProject,
  listPostgresProjects,
  getPostgresProject,
  updatePostgresProject,
  deletePostgresProject,
} from '../services/postgresProject.service.js'

export const create = asyncHandler(async (req, res) => {
  const data = await createPostgresProject({ pool: getPostgresPool(), user: req.user, payload: req.body })
  res.status(201).json({ success: true, data })
})

export const list = asyncHandler(async (req, res) => {
  const data = await listPostgresProjects({ pool: getPostgresPool(), user: req.user })
  res.json({ success: true, data })
})

export const getOne = asyncHandler(async (req, res) => {
  const data = await getPostgresProject({ pool: getPostgresPool(), user: req.user, projectId: req.params.projectId })
  res.json({ success: true, data })
})

export const update = asyncHandler(async (req, res) => {
  const data = await updatePostgresProject({
    pool: getPostgresPool(), user: req.user, projectId: req.params.projectId, payload: req.body,
  })
  res.json({ success: true, data })
})

export const remove = asyncHandler(async (req, res) => {
  const data = await deletePostgresProject({ pool: getPostgresPool(), user: req.user, projectId: req.params.projectId })
  res.json({ success: true, data })
})
