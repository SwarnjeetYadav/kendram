import { Router } from 'express'
import { create, list } from '../controllers/comment.controller.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)
router.get('/tasks/:taskId/comments', list)
router.post('/tasks/:taskId/comments', create)
export default router
