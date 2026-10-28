import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { getPostgresPool } from '../db/postgres.js'
import { publishProjectChatMessage, publishProjectChatReaction } from '../services/chatRealtime.service.js'
import { listPostgresProjectMessages,sendPostgresProjectMessage,togglePostgresProjectMessageReaction } from '../services/postgresChat.service.js'
const router=Router()
router.use(requireAuth)
router.get('/:projectId/chat',asyncHandler(async(req,res)=>res.json({success:true,data:await listPostgresProjectMessages({pool:getPostgresPool(),projectId:req.params.projectId,userId:req.user.id,role:req.user.role,limit:req.query.limit})})))
router.post('/:projectId/chat',asyncHandler(async(req,res)=>{const data=await sendPostgresProjectMessage({pool:getPostgresPool(),projectId:req.params.projectId,userId:req.user.id,role:req.user.role,message:req.body.message,replyToId:req.body.replyToId,taskId:req.body.taskId,mentions:req.body.mentions});publishProjectChatMessage(req.params.projectId,data);res.status(201).json({success:true,data})}))
router.post('/:projectId/chat/:messageId/reactions',asyncHandler(async(req,res)=>{const data=await togglePostgresProjectMessageReaction({pool:getPostgresPool(),projectId:req.params.projectId,messageId:req.params.messageId,userId:req.user.id,role:req.user.role,emoji:req.body.emoji});publishProjectChatReaction(req.params.projectId,data);res.json({success:true,data})}))
export default router
