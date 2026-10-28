import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getPostgresPool } from '../db/postgres.js'
import { createPostgresTask, listPostgresTasks, updatePostgresTask, deletePostgresTask, listPostgresTaskActivity } from '../services/postgresTask.service.js'
import { addPostgresComment, listPostgresComments } from '../services/postgresComment.service.js'
import { addPostgresDependency, listPostgresDependencies, removePostgresDependency, listPostgresBlockers } from '../services/postgresDependency.service.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { getPostgresTaskAssignmentSuggestions } from '../services/postgresProject.service.js'

const router = Router()
router.use(requireAuth)

router.get('/project/:projectId', asyncHandler(async (req, res) => {
  const result = await listPostgresTasks({
    pool: getPostgresPool(),
    userId: req.user.id,
    role: req.user.role,
    projectId: req.params.projectId,
    query: req.query,
  })
  res.json({ success: true, data: result.tasks, meta: { pagination: result.pagination } })
}))

router.post('/project/:projectId', asyncHandler(async (req, res) => {
  const task = await createPostgresTask({
    pool: getPostgresPool(),
    userId: req.user.id,
    role: req.user.role,
    projectId: req.params.projectId,
    payload: req.body,
  })
  res.status(201).json({ success: true, data: task })
}))

router.delete('/:taskId', asyncHandler(async (req, res) => {
  const data = await deletePostgresTask({
    pool: getPostgresPool(),
    userId: req.user.id,
    role: req.user.role,
    taskId: req.params.taskId,
  })
  res.json({ success: true, data })
}))

router.patch('/:taskId', asyncHandler(async (req, res) => {
  const task = await updatePostgresTask({
    pool: getPostgresPool(),
    userId: req.user.id,
    role: req.user.role,
    taskId: req.params.taskId,
    payload: req.body,
  })
  res.json({ success: true, data: task })
}))

router.get('/:taskId/assignment-suggestions', asyncHandler(async (req, res) => {
  const data = await getPostgresTaskAssignmentSuggestions({
    pool: getPostgresPool(), user: req.user, taskId: req.params.taskId,
  })
  res.json({ success: true, data })
}))

router.get('/:taskId/activity', asyncHandler(async (req, res) => {
  const data = await listPostgresTaskActivity({
    pool: getPostgresPool(),
    taskId: req.params.taskId,
    userId: req.user.id,
    role: req.user.role,
  })
  res.json({ success: true, data })
}))

router.get('/:taskId/comments', asyncHandler(async (req, res) => {
  const data = await listPostgresComments({
    pool: getPostgresPool(),
    taskId: req.params.taskId,
    userId: req.user.id,
    role: req.user.role,
  })
  res.json({ success: true, data })
}))

router.post('/:taskId/comments', asyncHandler(async (req, res) => {
  const data = await addPostgresComment({
    pool: getPostgresPool(),
    taskId: req.params.taskId,
    userId: req.user.id,
    role: req.user.role,
    message: req.body.message,
  })
  res.status(201).json({ success: true, data })
}))

router.get('/:taskId/dependencies', asyncHandler(async (req, res) => {
  const data = await listPostgresDependencies({
    pool: getPostgresPool(), taskId: req.params.taskId,
    userId: req.user.id, role: req.user.role,
  })
  res.json({ success: true, data })
}))

router.post('/:taskId/dependencies', asyncHandler(async (req, res) => {
  const data = await addPostgresDependency({
    pool: getPostgresPool(), taskId: req.params.taskId,
    predecessorTaskId: req.body.predecessorTaskId,
    userId: req.user.id, role: req.user.role,
  })
  res.status(201).json({ success: true, data })
}))

router.delete('/:taskId/dependencies/:dependencyId', asyncHandler(async (req, res) => {
  const data = await removePostgresDependency({
    pool: getPostgresPool(), taskId: req.params.taskId,
    dependencyId: req.params.dependencyId,
    userId: req.user.id, role: req.user.role,
  })
  res.json({ success: true, data })
}))

router.get('/:taskId/blockers', asyncHandler(async (req, res) => {
  const data = await listPostgresBlockers({
    pool: getPostgresPool(), taskId: req.params.taskId,
    userId: req.user.id, role: req.user.role,
  })
  res.json({ success: true, data })
}))

export default router
