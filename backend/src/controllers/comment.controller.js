import { asyncHandler } from '../utils/asyncHandler.js'
import { addComment, listComments } from '../services/comment.service.js'

export const list = asyncHandler(async (req, res) => {
  const comments = await listComments({
    taskId: req.params.taskId,
    userId: req.user.id,
    role: req.user.role,
  })
  res.json({ success: true, data: comments })
})

export const create = asyncHandler(async (req, res) => {
  const comment = await addComment({
    taskId: req.params.taskId,
    userId: req.user.id,
    role: req.user.role,
    message: req.body.message,
  })
  res.status(201).json({ success: true, data: comment })
})
