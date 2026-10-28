import { asyncHandler } from '../utils/asyncHandler.js'
import { revokeProjectChatAccess } from '../services/chatRealtime.service.js'
import {
  addMember,
  listMembers,
  removeMember,
  searchMemberCandidates,
  updateMemberRole,
} from '../services/member.service.js'

export const list = asyncHandler(async (req, res) => {
  const members = await listMembers(req.params.projectId, req.user.id, req.user.role)
  res.json({ success: true, data: members })
})

export const candidates = asyncHandler(async (req, res) => {
  const members = await searchMemberCandidates(
    req.params.projectId,
    req.user.id,
    req.user.role,
    req.query.q || '',
  )
  res.json({ success: true, data: members })
})

export const add = asyncHandler(async (req, res) => {
  const member = await addMember(
    req.params.projectId,
    req.user.id,
    req.user.role,
    req.body.userId,
    req.body.projectRole,
  )
  res.status(201).json({ success: true, data: member })
})

export const updateRole = asyncHandler(async (req, res) => {
  const member = await updateMemberRole(
    req.params.projectId,
    req.params.memberUserId,
    req.user.id,
    req.user.role,
    req.body.projectRole,
  )
  res.json({ success: true, data: member })
})

export const remove = asyncHandler(async (req, res) => {
  const result = await removeMember(
    req.params.projectId,
    req.params.memberUserId,
    req.user.id,
    req.user.role,
  )
  await revokeProjectChatAccess(req.params.projectId, result.removedUserId)
  res.json({ success: true, data: result })
})
