import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getPostgresPool } from '../db/postgres.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { listPostgresNotifications, markPostgresNotificationRead } from '../services/postgresNotification.service.js'

const router = Router()
router.use(requireAuth)

router.get('/', asyncHandler(async (req, res) => {
  const data = await listPostgresNotifications({ pool:getPostgresPool(), userId:req.user.id })
  res.json({ success:true, data })
}))

router.patch('/:notificationId/read', asyncHandler(async (req, res) => {
  const data = await markPostgresNotificationRead({
    pool:getPostgresPool(), userId:req.user.id, notificationId:req.params.notificationId,
  })
  res.json({ success:true, data })
}))

export default router
