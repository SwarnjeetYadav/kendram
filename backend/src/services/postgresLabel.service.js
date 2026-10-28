import { ApiError } from '../utils/apiError.js'
import { resolvePostgresProjectAccess } from './postgresTaskMapping.service.js'
const COLOR=/^#[0-9a-f]{6}$/i
async function boardFor(client,projectId) {
 const r=await client.query('SELECT id FROM boards WHERE project_id=$1 ORDER BY created_at,id LIMIT 1',[projectId])
 if(!r.rows[0]) throw new ApiError(409,'This project has no PostgreSQL board')
 return r.rows[0].id
}
async function canManage(client,access) {
 if(access.user.role==='ADMINISTRATOR'||access.project.owner_id===access.user.id||access.membership?.project_role==='PROJECT_MANAGER') return
 throw new ApiError(403,'Only a project manager can manage labels')
}
export async function listPostgresLabels({pool,projectId,userId,role}) {
 const c=await pool.connect()
 try {
  const a=await resolvePostgresProjectAccess(c,{projectId,userId,role})
  const board=await boardFor(c,a.project.id)
  const r=await c.query('SELECT id,name,color FROM labels WHERE board_id=$1 ORDER BY name,id',[board])
  return r.rows.map(x=>({_id:x.id,id:x.id,name:x.name,color:x.color}))
 } finally {c.release()}
}
export async function createPostgresLabel({pool,projectId,userId,role,name,color='#64748b'}) {
 const clean=String(name||'').trim()
 if(!clean||clean.length>32) throw new ApiError(400,'Label name must be 1–32 characters')
 if(!COLOR.test(color)) throw new ApiError(400,'Label color must be a six-digit hex color')
 const c=await pool.connect()
 try {
  await c.query('BEGIN')
  const a=await resolvePostgresProjectAccess(c,{projectId,userId,role})
  await canManage(c,a)
  const board=await boardFor(c,a.project.id)
  const r=await c.query('INSERT INTO labels(board_id,name,color) VALUES($1,$2,$3) RETURNING id,name,color',[board,clean,color])
  await c.query("INSERT INTO activity_logs(user_id,action,entity_type,entity_id,metadata) VALUES($1,'PROJECT_LABEL_CREATED','PROJECT',$2,$3::jsonb)",[a.user.id,a.project.id,JSON.stringify({labelId:r.rows[0].id,name:clean})])
  await c.query('COMMIT')
  return {_id:r.rows[0].id,id:r.rows[0].id,name:r.rows[0].name,color:r.rows[0].color}
 } catch(e) {await c.query('ROLLBACK').catch(()=>{});if(e.code==='23505') throw new ApiError(409,'A label with this name already exists');throw e} finally {c.release()}
}
export async function updatePostgresLabel({pool,projectId,userId,role,labelId,name,color}) {
 const clean=name===undefined?undefined:String(name).trim()
 if(clean!==undefined&&(!clean||clean.length>32)) throw new ApiError(400,'Label name must be 1–32 characters')
 if(color!==undefined&&!COLOR.test(color)) throw new ApiError(400,'Label color must be a six-digit hex color')
 if(clean===undefined&&color===undefined) throw new ApiError(400,'Provide a label name or color')
 const c=await pool.connect()
 try {
  await c.query('BEGIN')
  const a=await resolvePostgresProjectAccess(c,{projectId,userId,role})
  await canManage(c,a)
  const board=await boardFor(c,a.project.id)
  const r=await c.query('UPDATE labels SET name=COALESCE($3,name),color=COALESCE($4,color) WHERE id::text=$1 AND board_id=$2 RETURNING id,name,color',[String(labelId),board,clean??null,color??null])
  if(!r.rows[0]) throw new ApiError(404,'Label not found')
  await c.query('COMMIT')
  return {_id:r.rows[0].id,id:r.rows[0].id,name:r.rows[0].name,color:r.rows[0].color}
 } catch(e) {await c.query('ROLLBACK').catch(()=>{});if(e.code==='23505') throw new ApiError(409,'A label with this name already exists');throw e} finally {c.release()}
}
export async function deletePostgresLabel({pool,projectId,userId,role,labelId}) {
 const c=await pool.connect()
 try {
  await c.query('BEGIN')
  const a=await resolvePostgresProjectAccess(c,{projectId,userId,role})
  await canManage(c,a)
  const board=await boardFor(c,a.project.id)
  const r=await c.query('DELETE FROM labels WHERE id::text=$1 AND board_id=$2 RETURNING id',[String(labelId),board])
  if(!r.rows[0]) throw new ApiError(404,'Label not found')
  await c.query('COMMIT')
  return {id:r.rows[0].id,deleted:true}
 } catch(e) {await c.query('ROLLBACK').catch(()=>{});throw e} finally {c.release()}
}
