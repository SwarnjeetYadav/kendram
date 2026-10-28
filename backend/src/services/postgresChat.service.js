import { ApiError } from '../utils/apiError.js'
import { resolvePostgresProjectAccess, validateLegacyMongoId } from './postgresTaskMapping.service.js'

const EMOJIS=['👍','❤️','✅','👀','🚀']
function messageDto(r) {
 return { _id:r.id,id:r.id,projectId:r.project_legacy_id,userId:{_id:r.user_legacy_id,name:r.user_name,email:r.user_email,role:r.user_role},message:r.message,createdAt:r.created_at,updatedAt:r.updated_at,replyToId:r.reply_id?{_id:r.reply_id,userId:r.reply_user_legacy_id?{_id:r.reply_user_legacy_id,name:r.reply_user_name}:null,message:r.reply_message,createdAt:r.reply_created_at}:null,taskId:r.task_id?{_id:r.task_legacy_id,title:r.task_title,status:r.task_status,priority:r.task_priority}:null,mentions:r.mentions||[],reactions:r.reactions||[] }
}
const select=`SELECT m.*,p.legacy_mongo_id AS project_legacy_id,
 u.legacy_mongo_id AS user_legacy_id,u.name AS user_name,u.email AS user_email,u.role AS user_role,
 reply.id AS reply_id,reply.message AS reply_message,reply.created_at AS reply_created_at,
 ru.legacy_mongo_id AS reply_user_legacy_id,ru.name AS reply_user_name,
 t.legacy_mongo_id AS task_legacy_id,t.title AS task_title,c.name AS task_status,t.priority AS task_priority
 FROM project_messages m JOIN projects p ON p.id=m.project_id JOIN users u ON u.id=m.user_id
 LEFT JOIN project_messages reply ON reply.id=m.reply_to_id
 LEFT JOIN users ru ON ru.id=reply.user_id
 LEFT JOIN tasks t ON t.id=m.task_id LEFT JOIN board_columns c ON c.id=t.column_id`
async function findMessage(client,projectId,messageId) {
 const r=await client.query(select+' WHERE m.project_id=$1 AND m.id::text=$2',[projectId,String(messageId)])
 if(!r.rows[0]) throw new ApiError(404,'Message not found')
 return messageDto(r.rows[0])
}
export async function listPostgresProjectMessages({pool,projectId,userId,role,limit=60}) {
 const c=await pool.connect()
 try {
  const access=await resolvePostgresProjectAccess(c,{projectId,userId,role})
  const safe=Math.max(1,Math.min(Number.parseInt(limit,10)||60,60))
  const r=await c.query(select+' WHERE m.project_id=$1 ORDER BY m.created_at DESC,m.id DESC LIMIT $2',[access.project.id,safe])
  return r.rows.reverse().map(messageDto)
 } finally {c.release()}
}
export async function sendPostgresProjectMessage({pool,projectId,userId,role,message,replyToId=null,taskId=null,mentions=[]}) {
 const clean=String(message||'').trim()
 if(!clean) throw new ApiError(400,'Chat message is required')
 if(clean.length>2000) throw new ApiError(400,'Chat message is too long')
 const c=await pool.connect()
 try {
  await c.query('BEGIN')
  const access=await resolvePostgresProjectAccess(c,{projectId,userId,role})
  let reply=null, task=null
  if(replyToId) {
   const r=await c.query('SELECT id FROM project_messages WHERE id::text=$1 AND project_id=$2',[String(replyToId),access.project.id])
   if(!r.rows[0]) throw new ApiError(422,'Reply target does not belong to this project')
   reply=r.rows[0].id
  }
  if(taskId) {
   const legacy=String(taskId)
   const r=await c.query('SELECT id FROM tasks WHERE board_id IN (SELECT id FROM boards WHERE project_id=$1) AND (id::text=$2 OR legacy_mongo_id=$2)',[access.project.id,legacy])
   if(!r.rows[0]) throw new ApiError(422,'Task context does not belong to this project')
   task=r.rows[0].id
  }
  const mentionIds=[...new Set((Array.isArray(mentions)?mentions:[]).map(String).filter(x=>/^[a-f\d]{24}$/i.test(x)))].slice(0,10)
  const mentionRows=mentionIds.length?await c.query("SELECT u.id,u.legacy_mongo_id,u.name,u.email,u.preferences FROM users u JOIN project_members pm ON pm.user_id=u.id WHERE pm.project_id=$1 AND u.legacy_mongo_id=ANY($2::text[])",[access.project.id,mentionIds]):{rows:[]}
  const cleanMentions=mentionRows.rows.filter(u=>u.id!==access.user.id).map(u=>({_id:u.legacy_mongo_id,name:u.name,email:u.email}))
  const inserted=await c.query("INSERT INTO project_messages(project_id,user_id,message,reply_to_id,task_id,mentions) VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING id",[access.project.id,access.user.id,clean,reply,task,JSON.stringify(cleanMentions)])
  await c.query("INSERT INTO activity_logs(user_id,action,entity_type,entity_id,metadata) VALUES($1,'PROJECT_CHAT_MESSAGE','PROJECT',$2,$3::jsonb)",[access.user.id,access.project.id,JSON.stringify({messageId:inserted.rows[0].id,taskId:task,replyToId:reply,mentions:cleanMentions.map(x=>x._id)})])
  for(const recipient of mentionRows.rows.filter(u=>u.id!==access.user.id && u.preferences?.notifications?.chatMention !== false)) {
   await c.query("INSERT INTO notifications(user_id,type,message,entity_id) VALUES($1,'PROJECT_CHAT_MENTION',$2,$3)",[recipient.id,'You were mentioned in '+access.project.legacy_mongo_id+' team chat.',access.project.id])
  }
  const data=await findMessage(c,access.project.id,inserted.rows[0].id)
  await c.query('COMMIT')
  return data
 } catch(e) {await c.query('ROLLBACK').catch(()=>{});throw e} finally {c.release()}
}
export async function togglePostgresProjectMessageReaction({pool,projectId,messageId,userId,role,emoji}) {
 if(!EMOJIS.includes(emoji)) throw new ApiError(400,'Unsupported reaction')
 const c=await pool.connect()
 try {
  await c.query('BEGIN')
  const access=await resolvePostgresProjectAccess(c,{projectId,userId,role})
  const r=await c.query('SELECT id,reactions FROM project_messages WHERE id::text=$1 AND project_id=$2 FOR UPDATE',[String(messageId),access.project.id])
  if(!r.rows[0]) throw new ApiError(404,'Message not found')
  const reactions=Array.isArray(r.rows[0].reactions)?r.rows[0].reactions:[]
  const current=reactions.findIndex(x=>String(x.userId)===String(userId)&&x.emoji===emoji)
  if(current>=0) reactions.splice(current,1); else reactions.push({userId,emoji})
  await c.query('UPDATE project_messages SET reactions=$2::jsonb,updated_at=now() WHERE id=$1',[r.rows[0].id,JSON.stringify(reactions)])
  const data=await findMessage(c,access.project.id,r.rows[0].id)
  await c.query('COMMIT')
  return data
 } catch(e) {await c.query('ROLLBACK').catch(()=>{});throw e} finally {c.release()}
}
