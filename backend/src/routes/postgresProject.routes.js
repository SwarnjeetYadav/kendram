import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { create, list, getOne, update, remove } from '../controllers/postgresProject.controller.js'

const router = Router()
router.use(requireAuth)
router.route('/').post(create).get(list)
router.route('/:projectId').get(getOne).patch(update).delete(remove)
export default router
