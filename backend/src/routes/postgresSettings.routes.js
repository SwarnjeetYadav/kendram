import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getPostgresPool } from '../db/postgres.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { getPostgresPreferences, updatePostgresPreferences } from '../services/postgresSettings.service.js'

const router=Router()
router.use(requireAuth)
router.get('/preferences',asyncHandler(async(req,res)=>{
  const data=await getPostgresPreferences({pool:getPostgresPool(),userId:req.user.id})
  res.json({success:true,data})
}))
router.patch('/preferences',asyncHandler(async(req,res)=>{
  const data=await updatePostgresPreferences({pool:getPostgresPool(),userId:req.user.id,patch:req.body})
  res.json({success:true,data})
}))
export default router
