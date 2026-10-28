import { Router } from 'express'
import { search } from '../controllers/search.controller.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.get('/', requireAuth, search)
export default router
