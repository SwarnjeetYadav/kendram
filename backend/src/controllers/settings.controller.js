import { asyncHandler } from '../utils/asyncHandler.js'
import User from '../models/User.js'
import { ApiError } from '../utils/apiError.js'

const DEFAULTS = {
  notifications: {
    taskAssignment: true,
    projectInvitation: true,
    chatMention: true,
    dependencyUnblocked: true,
    teamUpdates: true,
  },
  display: {
    compactMode: false,
  },
}

function mergePreferences(current, patch) {
  return {
    notifications: { ...DEFAULTS.notifications, ...(current?.notifications || {}), ...(patch?.notifications || {}) },
    display: { ...DEFAULTS.display, ...(current?.display || {}), ...(patch?.display || {}) },
  }
}

export const getPreferences = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select('preferences').lean()
  res.json({ success: true, data: mergePreferences(user?.preferences, {}) })
})

export const updatePreferences = asyncHandler(async (req, res) => {
  if (!req.body || typeof req.body !== 'object') throw new ApiError(400, 'Invalid preferences payload')
  const user = await User.findById(req.user.id).select('preferences')
  if (!user) throw new ApiError(404, 'User not found')

  user.preferences = mergePreferences(user.preferences, req.body)
  await user.save()
  res.json({ success: true, data: user.preferences })
})
