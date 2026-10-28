import { Router } from 'express'
import { add, candidates, list, remove, updateRole } from '../controllers/member.controller.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)
router.get('/:projectId/members', list)
router.get('/:projectId/members/candidates', candidates)
router.post('/:projectId/members', add)
router.patch('/:projectId/members/:memberUserId', updateRole)
router.delete('/:projectId/members/:memberUserId', remove)

export default router
