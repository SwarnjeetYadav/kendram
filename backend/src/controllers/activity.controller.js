import { asyncHandler } from '../utils/asyncHandler.js'
import ActivityLog from '../models/ActivityLog.js'

export const list = asyncHandler(async (req, res) => {
  const activities = await ActivityLog.find({ userId: req.user.id })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('userId', 'name email role')
    .lean()

  res.json({ success: true, data: activities })
})
