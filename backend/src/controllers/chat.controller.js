import { asyncHandler } from '../utils/asyncHandler.js'
import { listProjectMessages, sendProjectMessage, toggleProjectMessageReaction } from '../services/chat.service.js'
import { publishProjectChatMessage, publishProjectChatReaction } from '../services/chatRealtime.service.js'

export const list = asyncHandler(async (req, res) => {
  const data = await listProjectMessages({ projectId: req.params.projectId, userId: req.user.id, role: req.user.role, limit: req.query.limit })
  res.json({ success: true, data })
})

export const send = asyncHandler(async (req, res) => {
  const data = await sendProjectMessage({ projectId: req.params.projectId, userId: req.user.id, role: req.user.role, message: req.body.message, replyToId: req.body.replyToId, taskId: req.body.taskId, mentions: req.body.mentions })
  publishProjectChatMessage(req.params.projectId, data)
  res.status(201).json({ success: true, data })
})

export const react = asyncHandler(async (req, res) => {
  const data = await toggleProjectMessageReaction({ projectId: req.params.projectId, messageId: req.params.messageId, userId: req.user.id, role: req.user.role, emoji: req.body.emoji })
  publishProjectChatReaction(req.params.projectId, data)
  res.json({ success: true, data })
})
