import { asyncHandler } from '../utils/asyncHandler.js'
import Notification from '../models/Notification.js'
import mongoose from 'mongoose'
import { ApiError } from '../utils/apiError.js'

export const list = asyncHandler(async (req, res) => {
  const notifications = await Notification.find({ userId: req.user.id })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean()

  res.json({ success: true, data: notifications })
})

export const markRead = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.notificationId)) {
    throw new ApiError(400, 'Invalid notification id')
  }

  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.notificationId, userId: req.user.id },
    { $set: { readAt: new Date() } },
    { new: true },
  ).lean()

  if (!notification) throw new ApiError(404, 'Notification not found')
  res.json({ success: true, data: notification })
})
