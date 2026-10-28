import { asyncHandler } from '../utils/asyncHandler.js'
import { revokeProjectChatAccess } from '../services/chatRealtime.service.js'
import { getPostgresPool } from '../db/postgres.js'
import {
  listPostgresProjectMembers,
  addPostgresProjectMember,
  updatePostgresProjectMemberRole,
  removePostgresProjectMember,
  searchPostgresProjectMemberCandidates,
  getPostgresAssignmentSuggestions,
} from '../services/postgresProject.service.js'

export const listMembers = asyncHandler(async (req, res) => {
  const data = await listPostgresProjectMembers({ pool: getPostgresPool(), user: req.user, projectId: req.params.projectId })
  res.json({ success: true, data })
})

export const candidates = asyncHandler(async (req, res) => {
  const data = await searchPostgresProjectMemberCandidates({
    pool: getPostgresPool(), user: req.user, projectId: req.params.projectId, query: req.query.q || '',
  })
  res.json({ success: true, data })
})

export const assignmentSuggestions = asyncHandler(async (req, res) => {
  const estimateMinutes = req.query.estimateMinutes ? Number(req.query.estimateMinutes) : null
  const data = await getPostgresAssignmentSuggestions({
    pool: getPostgresPool(), user: req.user, projectId: req.params.projectId,
    priority: req.query.priority || 'MEDIUM', dueDate: req.query.dueDate || null, estimateMinutes,
  })
  res.json({ success: true, data })
})

export const addMember = asyncHandler(async (req, res) => {
  const data = await addPostgresProjectMember({
    pool: getPostgresPool(), user: req.user, projectId: req.params.projectId,
    memberUserId: req.body.userId, projectRole: req.body.projectRole || 'MEMBER',
  })
  res.status(201).json({ success: true, data })
})

export const updateMemberRole = asyncHandler(async (req, res) => {
  const data = await updatePostgresProjectMemberRole({
    pool: getPostgresPool(), user: req.user, projectId: req.params.projectId,
    memberUserId: req.params.memberUserId, projectRole: req.body.projectRole,
  })
  res.json({ success: true, data })
})

export const removeMember = asyncHandler(async (req, res) => {
  const data = await removePostgresProjectMember({
    pool: getPostgresPool(), user: req.user, projectId: req.params.projectId,
    memberUserId: req.params.memberUserId,
  })
  await revokeProjectChatAccess(req.params.projectId, data.removedUserId || req.params.memberUserId)
  res.json({ success: true, data })
})
