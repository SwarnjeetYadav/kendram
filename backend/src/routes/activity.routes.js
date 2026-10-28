import { Router } from 'express'
import { list } from '../controllers/activity.controller.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.get('/', requireAuth, list)
export default router
