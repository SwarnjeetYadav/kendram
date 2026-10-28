import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { listMembers, candidates, assignmentSuggestions, addMember, updateMemberRole, removeMember } from '../controllers/postgresProjectMember.controller.js'

const router = Router()
router.use(requireAuth)
router.get('/:projectId/members/candidates', candidates)
router.get('/:projectId/assignment-suggestions', assignmentSuggestions)
router.get('/:projectId/members', listMembers)
router.post('/:projectId/members', addMember)
router.patch('/:projectId/members/:memberUserId', updateMemberRole)
router.delete('/:projectId/members/:memberUserId', removeMember)
export default router
