import { Router } from 'express'
import authRoutes from './auth.routes.js'
import projectRoutes from './project.routes.js'
import taskRoutes from './task.routes.js'
import memberRoutes from './member.routes.js'
import chatRoutes from './chat.routes.js'
import commentRoutes from './comment.routes.js'
import activityRoutes from './activity.routes.js'
import notificationRoutes from './notification.routes.js'
import dashboardRoutes from './dashboard.routes.js'
import searchRoutes from './search.routes.js'
import invitationRoutes from './invitation.routes.js'
import settingsRoutes from './settings.routes.js'
import postgresTaskRoutes from './postgresTask.routes.js'
import postgresProjectRoutes from './postgresProject.routes.js'
import postgresProjectMemberRoutes from './postgresProjectMember.routes.js'
import postgresNotificationRoutes from './postgresNotification.routes.js'
import postgresSettingsRoutes from './postgresSettings.routes.js'
import postgresWorkspaceRoutes from './postgresWorkspace.routes.js'
import postgresInvitationRoutes from './postgresInvitation.routes.js'
import postgresChatRoutes from './postgresChat.routes.js'
import postgresLabelRoutes from './postgresLabel.routes.js'

const router = Router()
router.use('/auth', authRoutes)

if (process.env.PERSISTENCE_DRIVER === 'postgres') {
  // In PostgreSQL-only mode, never fall through to MongoDB-backed handlers.
  // Unsupported endpoints should return 404 rather than silently using MongoDB.
  router.use('/postgres/projects', postgresProjectRoutes)
  router.use('/postgres/projects', postgresProjectMemberRoutes)
  router.use('/postgres/notifications', postgresNotificationRoutes)
  router.use('/postgres/settings', postgresSettingsRoutes)
  router.use('/postgres', postgresWorkspaceRoutes)
  router.use('/postgres/invitations', postgresInvitationRoutes)
  router.use('/postgres/projects', postgresChatRoutes)
  router.use('/postgres/projects', postgresLabelRoutes)
  router.use('/postgres/tasks', postgresTaskRoutes)
} else {
  router.use('/projects', projectRoutes)
  router.use('/tasks', taskRoutes)
  router.use('/projects', memberRoutes)
  router.use('/projects', chatRoutes)
  router.use('/comments', commentRoutes)
  router.use('/activity', activityRoutes)
  router.use('/notifications', notificationRoutes)
  router.use('/dashboard', dashboardRoutes)
  router.use('/search', searchRoutes)
  router.use('/invitations', invitationRoutes)
  router.use('/settings', settingsRoutes)

  // Opt-in PostgreSQL APIs for staged migration while MongoDB remains primary.
  if (process.env.POSTGRES_PROJECTS_ENABLED === 'true') {
    router.use('/postgres/projects', postgresProjectRoutes)
    router.use('/postgres/projects', postgresProjectMemberRoutes)
    router.use('/postgres/notifications', postgresNotificationRoutes)
    router.use('/postgres/settings', postgresSettingsRoutes)
    router.use('/postgres', postgresWorkspaceRoutes)
    router.use('/postgres/invitations', postgresInvitationRoutes)
    router.use('/postgres/projects', postgresChatRoutes)
    router.use('/postgres/projects', postgresLabelRoutes)
  }
  if (process.env.POSTGRES_TASKS_ENABLED === 'true') {
    router.use('/postgres/tasks', postgresTaskRoutes)
  }
}

export default router
