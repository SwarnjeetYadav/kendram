import { Router } from 'express'
import { create, list, getOne } from '../controllers/project.controller.js'
import { analytics, insights, assignmentSuggestions, activity, listInvitations, invite } from '../controllers/advancedProject.controller.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)
router.post('/', create)
router.get('/', list)
router.get('/:projectId/analytics', analytics)
router.get('/:projectId/insights', insights)
router.get('/:projectId/assignment-suggestions', assignmentSuggestions)
router.get('/:projectId/activity', activity)
router.get('/:projectId/invitations', listInvitations)
router.post('/:projectId/invitations', invite)
router.get('/:projectId', getOne)
export default router
