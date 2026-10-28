import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { listMyInvitations, respondToInvitation } from '../services/invitation.service.js'

const router = Router()
router.use(requireAuth)

router.get('/', asyncHandler(async (req, res) => {
  const data = await listMyInvitations({ userId: req.user.id })
  res.json({ success: true, data })
}))

router.patch('/:invitationId', asyncHandler(async (req, res) => {
  const data = await respondToInvitation({
    invitationId: req.params.invitationId,
    userId: req.user.id,
    action: req.body.action,
  })
  res.json({ success: true, data })
}))

export default router
