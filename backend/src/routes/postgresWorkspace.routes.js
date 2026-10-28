import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import {
  getPostgresDashboard,
  searchPostgresWorkspace,
  listPostgresActivity,
  getPostgresProjectAnalytics,
  getPostgresProjectInsights,
} from '../services/postgresWorkspace.service.js'
import { getPostgresPool } from '../db/postgres.js'

const router = Router()
router.use(requireAuth)

router.get('/dashboard/summary', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getPostgresDashboard({ pool: getPostgresPool(), userId: req.user.id }) })
}))

router.get('/search', asyncHandler(async (req, res) => {
  const data = await searchPostgresWorkspace({ pool: getPostgresPool(), userId: req.user.id, query: req.query.q, scope: req.query.scope })
  res.json({ success: true, data })
}))

router.get('/activity', asyncHandler(async (req, res) => {
  const data = await listPostgresActivity({ pool: getPostgresPool(), userId: req.user.id, limit: req.query.limit })
  res.json({ success: true, data })
}))

router.get('/projects/:projectId/activity', asyncHandler(async (req, res) => {
  const data = await listPostgresActivity({
    pool: getPostgresPool(),
    userId: req.user.id,
    projectId: req.params.projectId,
    limit: req.query.limit,
  })
  res.json({ success: true, data })
}))

router.get('/projects/:projectId/analytics', asyncHandler(async (req, res) => {
  const data = await getPostgresProjectAnalytics({
    pool: getPostgresPool(),
    userId: req.user.id,
    projectId: req.params.projectId,
  })
  res.json({ success: true, data })
}))

router.get('/projects/:projectId/insights', asyncHandler(async (req, res) => {
  const data = await getPostgresProjectInsights({
    pool: getPostgresPool(),
    userId: req.user.id,
    projectId: req.params.projectId,
  })
  res.json({ success: true, data })
}))

export default router
