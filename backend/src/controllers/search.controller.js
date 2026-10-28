import { asyncHandler } from '../utils/asyncHandler.js'
import { searchWorkspace } from '../services/search.service.js'

export const search = asyncHandler(async (req, res) => {
  const data = await searchWorkspace({
    userId: req.user.id,
    role: req.user.role,
    query: req.query.q || '',
    scope: req.query.scope || 'workspace',
  })
  res.json({ success: true, data })
})
