import { Router } from 'express'
import { list, markRead } from '../controllers/notification.controller.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)
router.get('/', list)
router.patch('/:notificationId/read', markRead)
export default router
