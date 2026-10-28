import { Router } from 'express'
import { login, me, register, updateProfile, verifyEmail, resendVerification, forgotPassword, completePasswordReset } from '../controllers/auth.controller.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.post('/register', register)
router.post('/login', login)
router.post('/verify-email', verifyEmail)
router.post('/resend-verification', resendVerification)
router.post('/forgot-password', forgotPassword)
router.post('/reset-password', completePasswordReset)
router.get('/me', requireAuth, me)
router.patch('/profile', requireAuth, updateProfile)
export default router
