import User from '../models/User.js'
import Notification from '../models/Notification.js'

const preferenceByType = {
  TASK_ASSIGNED: 'taskAssignment',
  PROJECT_INVITATION: 'projectInvitation',
  PROJECT_INVITATION_ACCEPTED: 'projectInvitation',
  PROJECT_MEMBER_ADDED: 'teamUpdates',
  PROJECT_CHAT_MENTION: 'chatMention',
  DEPENDENCY_UNBLOCKED: 'dependencyUnblocked',
}

export async function createNotification({ userId, type, message, entityId = null }) {
  const preferenceKey = preferenceByType[type]
  if (preferenceKey) {
    const user = await User.findById(userId).select('preferences.notifications').lean()
    if (user?.preferences?.notifications?.[preferenceKey] === false) return null
  }

  return Notification.create({ userId, type, message, entityId })
}
