import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getPostgresPool } from '../db/postgres.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { createPostgresInvitation, listPostgresProjectInvitations, listMyPostgresInvitations, respondToPostgresInvitation } from '../services/postgresInvitation.service.js'
const router=Router()
router.use(requireAuth)
router.get('/mine',asyncHandler(async(req,res)=>res.json({success:true,data:await listMyPostgresInvitations({pool:getPostgresPool(),userId:req.user.id})})))
router.patch('/:invitationId',asyncHandler(async(req,res)=>res.json({success:true,data:await respondToPostgresInvitation({pool:getPostgresPool(),invitationId:req.params.invitationId,userId:req.user.id,action:req.body.action})})))
router.get('/project/:projectId',asyncHandler(async(req,res)=>res.json({success:true,data:await listPostgresProjectInvitations({pool:getPostgresPool(),projectId:req.params.projectId,userId:req.user.id,role:req.user.role})})))
router.post('/project/:projectId',asyncHandler(async(req,res)=>res.status(201).json({success:true,data:await createPostgresInvitation({pool:getPostgresPool(),projectId:req.params.projectId,userId:req.user.id,role:req.user.role,invitedUserId:req.body.invitedUserId,projectRole:req.body.projectRole})})))
export default router
