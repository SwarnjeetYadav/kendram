import {Router} from 'express'
import {requireAuth} from '../middleware/auth.js'
import {asyncHandler} from '../utils/asyncHandler.js'
import {getPostgresPool} from '../db/postgres.js'
import {listPostgresLabels,createPostgresLabel,updatePostgresLabel,deletePostgresLabel} from '../services/postgresLabel.service.js'
const router=Router()
router.use(requireAuth)
router.get('/:projectId/labels',asyncHandler(async(req,res)=>res.json({success:true,data:await listPostgresLabels({pool:getPostgresPool(),projectId:req.params.projectId,userId:req.user.id,role:req.user.role})})))
router.post('/:projectId/labels',asyncHandler(async(req,res)=>res.status(201).json({success:true,data:await createPostgresLabel({pool:getPostgresPool(),projectId:req.params.projectId,userId:req.user.id,role:req.user.role,name:req.body.name,color:req.body.color})})))
router.patch('/:projectId/labels/:labelId',asyncHandler(async(req,res)=>res.json({success:true,data:await updatePostgresLabel({pool:getPostgresPool(),projectId:req.params.projectId,userId:req.user.id,role:req.user.role,labelId:req.params.labelId,name:req.body.name,color:req.body.color})})))
router.delete('/:projectId/labels/:labelId',asyncHandler(async(req,res)=>res.json({success:true,data:await deletePostgresLabel({pool:getPostgresPool(),projectId:req.params.projectId,userId:req.user.id,role:req.user.role,labelId:req.params.labelId})})))
export default router
