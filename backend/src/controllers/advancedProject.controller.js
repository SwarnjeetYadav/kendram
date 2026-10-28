import { asyncHandler } from '../utils/asyncHandler.js'
import { getProjectAnalytics } from '../services/analytics.service.js'
import { getProjectInsights } from '../services/insights.service.js'
import { createInvitation, listProjectInvitations } from '../services/invitation.service.js'
import { ensureProjectAccess } from '../services/project.service.js'
import { suggestAssignees } from '../services/assignment.service.js'
import ActivityLog from '../models/ActivityLog.js'
import Task from '../models/Task.js'

export const analytics = asyncHandler(async (req, res) => {
  await ensureProjectAccess(req.params.projectId, req.user.id, req.user.role)
  const data = await getProjectAnalytics(req.params.projectId)
  res.json({ success: true, data })
})

export const insights = asyncHandler(async (req, res) => {
  await ensureProjectAccess(req.params.projectId, req.user.id, req.user.role)
  const data = await getProjectInsights(req.params.projectId)
  res.json({ success: true, data })
})

export const assignmentSuggestions = asyncHandler(async (req, res) => {
  await ensureProjectAccess(req.params.projectId, req.user.id, req.user.role)
  const data = await suggestAssignees({
    projectId: req.params.projectId,
    priority: req.query.priority || 'MEDIUM',
    dueDate: req.query.dueDate || null,
    estimateMinutes: req.query.estimateMinutes ? Number(req.query.estimateMinutes) : null,
  })
  res.json({ success: true, data })
})

export const activity = asyncHandler(async (req, res) => {
  await ensureProjectAccess(req.params.projectId, req.user.id, req.user.role)
  const taskIds = await Task.find({ projectId: req.params.projectId }).distinct('_id')
  const data = await ActivityLog.find({
    $or: [
      { entityType: 'PROJECT', entityId: req.params.projectId },
      { entityType: 'TASK', entityId: { $in: taskIds } },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(150)
    .populate('userId', 'name email role')
    .lean()
  res.json({ success: true, data })
})

export const listInvitations = asyncHandler(async (req, res) => {
  const data = await listProjectInvitations({
    projectId: req.params.projectId,
    userId: req.user.id,
    role: req.user.role,
  })
  res.json({ success: true, data })
})

export const invite = asyncHandler(async (req, res) => {
  const invitation = await createInvitation({
    projectId: req.params.projectId,
    userId: req.user.id,
    role: req.user.role,
    invitedUserId: req.body.invitedUserId,
    projectRole: req.body.projectRole,
  })
  res.status(201).json({ success: true, data: invitation })
})
