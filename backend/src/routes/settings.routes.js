import { Router } from 'express'
import { getPreferences, updatePreferences } from '../controllers/settings.controller.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)
router.get('/preferences', getPreferences)
router.patch('/preferences', updatePreferences)
export default router
