import { Router } from 'express'
import { create, list, update, assignmentSuggestions, activity } from '../controllers/task.controller.js'
import { list as listDependencies, add as addDependency, remove as removeDependency, blockers } from '../controllers/dependency.controller.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)
router.get('/project/:projectId', list)
router.post('/project/:projectId', create)
router.patch('/:taskId', update)
router.get('/:taskId/assignment-suggestions', assignmentSuggestions)
router.get('/:taskId/dependencies', listDependencies)
router.post('/:taskId/dependencies', addDependency)
router.delete('/:taskId/dependencies/:dependencyId', removeDependency)
router.get('/:taskId/blockers', blockers)
router.get('/:taskId/activity', activity)
export default router
