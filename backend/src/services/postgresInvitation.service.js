import { ApiError } from '../utils/apiError.js'
import { validateLegacyMongoId } from './postgresTaskMapping.service.js'

const ROLES = new Set(['PROJECT_MANAGER','MEMBER','VIEWER'])
async function account(client,userId,{missingStatus=403,missingMessage='Your account is not mapped to PostgreSQL'}={}) {
  const id=validateLegacyMongoId(userId,'user id')
  const r=await client.query("SELECT id,legacy_mongo_id,role,preferences FROM users WHERE legacy_mongo_id=$1 AND status='ACTIVE'",[id])
  if(!r.rows[0]) throw new ApiError(missingStatus,missingMessage)
  return r.rows[0]
}
async function project(client,projectId,user,allowManager=false) {
  const id=validateLegacyMongoId(projectId,'project id')
  const r=await client.query(`SELECT p.*, (p.owner_id=$2) AS is_owner, pm.project_role
    FROM projects p LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=$2
    WHERE p.legacy_mongo_id=$1 AND ($3='ADMINISTRATOR' OR p.owner_id=$2 OR pm.user_id IS NOT NULL)`,[id,user.id,user.role])
  if(!r.rows[0]) throw new ApiError(404,'Project not found or not accessible')
  if(allowManager && user.role!=='ADMINISTRATOR' && !r.rows[0].is_owner && r.rows[0].project_role!=='PROJECT_MANAGER') throw new ApiError(403,'Only the project owner, administrator, or project manager can manage invitations')
  return r.rows[0]
}
function dto(r) {
 const invitedUserId = r.invited_user_legacy_id ? { _id: r.invited_user_legacy_id, name: r.invited_user_name, email: r.invited_user_email, role: r.invited_user_role } : null
 const invitedBy = r.invited_by_legacy_id ? { _id: r.invited_by_legacy_id, name: r.invited_by_name, email: r.invited_by_email, role: r.invited_by_role } : null
 const projectId = r.project_legacy_id ? { _id: r.project_legacy_id, name: r.project_name, ...(r.project_status ? { status: r.project_status } : {}) } : null
 return {
  id: r.id, _id: r.id,
  projectId, projectName: r.project_name, projectStatus: r.project_status,
  invitedUserId, invitedUserName: r.invited_user_name, invitedUserEmail: r.invited_user_email,
  invitedBy, invitedByName: r.invited_by_name, projectRole: r.project_role,
  status: r.status, expiresAt: r.expires_at, createdAt: r.created_at, updatedAt: r.updated_at,
 }
}
const select=`SELECT i.*,p.legacy_mongo_id AS project_legacy_id,p.name AS project_name,p.status AS project_status,
 iu.legacy_mongo_id AS invited_user_legacy_id,iu.name AS invited_user_name,iu.email AS invited_user_email,iu.role AS invited_user_role,
 ib.legacy_mongo_id AS invited_by_legacy_id,ib.name AS invited_by_name,ib.email AS invited_by_email,ib.role AS invited_by_role
 FROM invitations i JOIN projects p ON p.id=i.project_id
 JOIN users iu ON iu.id=i.invited_user_id JOIN users ib ON ib.id=i.invited_by`
export async function createPostgresInvitation({pool,projectId,userId,role,invitedUserId,projectRole='MEMBER'}) {
 if(!ROLES.has(projectRole)) throw new ApiError(400,'Invalid project role')
 const c=await pool.connect()
 try {
  await c.query('BEGIN')
  const actor=await account(c,userId)
  const p=await project(c,projectId,actor,true)
  const target=await account(c,invitedUserId,{missingStatus:404,missingMessage:'User not found or inactive'})
  if(target.id===actor.id) throw new ApiError(400,'You cannot invite yourself to the project')
  const member=await c.query('SELECT 1 FROM project_members WHERE project_id=$1 AND user_id=$2',[p.id,target.id])
  if(member.rows.length) throw new ApiError(409,'User is already a project member')
  await c.query("UPDATE invitations SET status='EXPIRED',updated_at=now() WHERE project_id=$1 AND invited_user_id=$2 AND status='PENDING' AND expires_at<now()",[p.id,target.id])
  const pending=await c.query("SELECT 1 FROM invitations WHERE project_id=$1 AND invited_user_id=$2 AND status='PENDING' AND expires_at>=now() FOR UPDATE",[p.id,target.id])
  if(pending.rows.length) throw new ApiError(409,'A pending invitation already exists for this user')
  const inserted=await c.query("INSERT INTO invitations(project_id,invited_user_id,project_role,expires_at,invited_by) VALUES($1,$2,$3,now()+interval '7 days',$4) RETURNING id",[p.id,target.id,projectRole,actor.id])
  if (target.preferences?.notifications?.projectInvitation !== false) {
   await c.query("INSERT INTO notifications(user_id,type,message,entity_id) VALUES($1,'PROJECT_INVITATION',$2,$3)",[target.id,'You were invited to join "'+p.name+'" as '+projectRole.replaceAll('_',' ').toLowerCase()+'.',p.id])
  }
  await c.query("INSERT INTO activity_logs(user_id,action,entity_type,entity_id,metadata) VALUES($1,'PROJECT_INVITATION_SENT','PROJECT',$2,$3::jsonb)",[actor.id,p.id,JSON.stringify({invitedUserId,projectRole,invitationId:inserted.rows[0].id})])
  const result=await c.query(select+' WHERE i.id=$1',[inserted.rows[0].id])
  await c.query('COMMIT')
  return dto(result.rows[0])
 } catch(e) { await c.query('ROLLBACK').catch(()=>{}); if(e.code==='23505') throw new ApiError(409,'A pending invitation already exists'); throw e }
 finally {c.release()}
}
export async function listPostgresProjectInvitations({pool,projectId,userId,role}) {
 const c=await pool.connect()
 try { const actor=await account(c,userId); const p=await project(c,projectId,actor,true)
  await c.query("UPDATE invitations SET status='EXPIRED',updated_at=now() WHERE project_id=$1 AND status='PENDING' AND expires_at<now()",[p.id])
  const r=await c.query(select+' WHERE i.project_id=$1 ORDER BY i.created_at DESC',[p.id]); return r.rows.map(dto)
 } finally {c.release()}
}
export async function listMyPostgresInvitations({pool,userId}) {
 const c=await pool.connect()
 try { const user=await account(c,userId)
  await c.query("UPDATE invitations SET status='EXPIRED',updated_at=now() WHERE invited_user_id=$1 AND status='PENDING' AND expires_at<now()",[user.id])
  const r=await c.query(select+" WHERE i.invited_user_id=$1 AND i.status='PENDING' ORDER BY i.expires_at ASC",[user.id]); return r.rows.map(dto)
 } finally {c.release()}
}
export async function respondToPostgresInvitation({pool,invitationId,userId,action}) {
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(invitationId))) throw new ApiError(400,'Invalid invitation id')
 if(!['ACCEPT','DECLINE'].includes(action)) throw new ApiError(400,'Invalid invitation action')
 const c=await pool.connect()
 try {
  await c.query('BEGIN')
  const user=await account(c,userId)
  const r=await c.query('SELECT * FROM invitations WHERE id::text=$1 AND invited_user_id=$2 FOR UPDATE',[String(invitationId),user.id])
  const i=r.rows[0]
  if(!i) throw new ApiError(404,'Invitation not found')
  if(i.status!=='PENDING') throw new ApiError(409,'Invitation is no longer pending')
  if(new Date(i.expires_at)<new Date()) { await c.query("UPDATE invitations SET status='EXPIRED',updated_at=now() WHERE id=$1",[i.id]); await c.query('COMMIT'); throw new ApiError(409,'Invitation has expired') }
  const next=action==='ACCEPT'?'ACCEPTED':'DECLINED'
  if(action==='ACCEPT') await c.query('INSERT INTO project_members(project_id,user_id,project_role) VALUES($1,$2,$3) ON CONFLICT(project_id,user_id) DO NOTHING',[i.project_id,user.id,i.project_role])
  await c.query('UPDATE invitations SET status=$2,updated_at=now() WHERE id=$1',[i.id,next])
  await c.query("INSERT INTO activity_logs(user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'PROJECT',$3,$4::jsonb)",[user.id,action==='ACCEPT'?'PROJECT_INVITATION_ACCEPTED':'PROJECT_INVITATION_DECLINED',i.project_id,JSON.stringify({invitationId:i.id,projectRole:i.project_role})])
  if(action==='ACCEPT') {
   const inviter=await c.query('SELECT preferences FROM users WHERE id=$1',[i.invited_by])
   if(inviter.rows[0]?.preferences?.notifications?.projectInvitation !== false) {
    await c.query("INSERT INTO notifications(user_id,type,message,entity_id) VALUES($1,'PROJECT_INVITATION_ACCEPTED','Your project invitation was accepted.',$2)",[i.invited_by,i.project_id])
   }
  }
  const out=await c.query(select+' WHERE i.id=$1',[i.id]); await c.query('COMMIT'); return dto(out.rows[0])
 } catch(e) { await c.query('ROLLBACK').catch(()=>{}); throw e } finally {c.release()}
}
