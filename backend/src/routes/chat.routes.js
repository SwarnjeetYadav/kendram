import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { list, send, react } from '../controllers/chat.controller.js'

const router = Router()
router.use(requireAuth)
router.get('/:projectId/chat', list)
router.post('/:projectId/chat', send)
router.post('/:projectId/chat/:messageId/reactions', react)
export default router
