import { asyncHandler } from '../utils/asyncHandler.js'
import {
  addDependency,
  listDependencies,
  removeDependency,
  getBlockingPredecessors,
} from '../services/dependency.service.js'

export const list = asyncHandler(async (req, res) => {
  const data = await listDependencies({
    taskId: req.params.taskId,
    userId: req.user.id,
    role: req.user.role,
  })
  res.json({ success: true, data })
})

export const add = asyncHandler(async (req, res) => {
  const data = await addDependency({
    taskId: req.params.taskId,
    predecessorTaskId: req.body.predecessorTaskId,
    userId: req.user.id,
    role: req.user.role,
  })
  res.status(201).json({ success: true, data })
})

export const remove = asyncHandler(async (req, res) => {
  const data = await removeDependency({
    taskId: req.params.taskId,
    dependencyId: req.params.dependencyId,
    userId: req.user.id,
    role: req.user.role,
  })
  res.json({ success: true, data })
})

export const blockers = asyncHandler(async (req, res) => {
  const data = await getBlockingPredecessors(req.params.taskId)
  res.json({ success: true, data })
})
