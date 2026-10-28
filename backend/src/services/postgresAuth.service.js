import bcrypt from 'bcryptjs'
import { createHash, randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { getPostgresPool } from '../db/postgres.js'
import { env } from '../config/env.js'
import { ApiError } from '../utils/apiError.js'

const ttl = 30 * 60 * 1000
const hash = value => createHash('sha256').update(value).digest('hex')
const token = () => randomBytes(32).toString('hex')
const link = (key, value) => env.appUrl + '/?' + key + '=' + encodeURIComponent(value)
async function sendEmail({to,subject,text,html}) {
  if (!env.resendApiKey) throw new ApiError(503,'Email delivery is not configured. Please contact the site administrator.')
  const response = await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.resendApiKey,'Content-Type':'application/json'},body:JSON.stringify({from:env.emailFrom,to:[to],subject,text,html})})
  if(!response.ok) throw new ApiError(502,'We could not send the email right now. Please try again shortly.')
}
function profile(row) { return {id:row.legacy_mongo_id || row.id,name:row.name,displayName:row.display_name||'',email:row.email,role:row.role,avatarUrl:row.avatar_url||'',bio:row.bio||'',location:row.location||'',timezone:row.timezone||'Asia/Kolkata',status:row.status} }
function accessToken(row) { return jwt.sign({sub:String(row.legacy_mongo_id || row.id),role:row.role,name:row.name},env.jwtSecret,{expiresIn:'7d'}) }
export async function postgresRegister({name,email,password}) {
  if(!name?.trim()||!email?.trim()||!password) throw new ApiError(400,'Name, email and password are required')
  if(name.trim().length>80) throw new ApiError(400,'Name must be at most 80 characters')
  if(password.length<8||password.length>128) throw new ApiError(400,'Password must be between 8 and 128 characters')
  const pool=getPostgresPool(), normalized=email.trim().toLowerCase(), raw=token()
  const c=await pool.connect()
  try {
    const result=await c.query("INSERT INTO users(name,email,password_hash,role,status,email_verified,email_verification_token_hash,email_verification_expires_at,legacy_mongo_id) VALUES($1,$2,$3,'TEAM_MEMBER','ACTIVE',false,$4,now()+interval '30 minutes',$5) RETURNING id,email,legacy_mongo_id",[name.trim(),normalized,await bcrypt.hash(password,12),hash(raw),randomBytes(12).toString('hex')])
    const user=result.rows[0], url=link('verifyEmail',raw)
    await sendEmail({to:user.email,subject:'Verify your Kendram email',text:'Verify your email within 30 minutes: '+url,html:'<p>Confirm your email address to activate your account.</p><p><a href="'+url+'">Verify email</a></p><p>This link expires in 30 minutes.</p>'})
    return {verificationRequired:true,email:user.email,message:'Account created. Check your email for a verification link; it expires in 30 minutes.'}
  } catch(e) { if(e.code==='23505') throw new ApiError(409,'Email is already registered'); throw e } finally {c.release()}
}
export async function postgresVerifyEmail(raw) {
  if(typeof raw!=='string'||!raw||raw.length>256) throw new ApiError(400,'A valid verification token is required')
  const r=await getPostgresPool().query("UPDATE users SET email_verified=true,email_verification_token_hash=NULL,email_verification_expires_at=NULL,updated_at=now() WHERE email_verification_token_hash=$1 AND email_verification_expires_at>now() RETURNING id",[hash(raw)])
  if(!r.rowCount) throw new ApiError(400,'This verification link is invalid or expired. Request a new one.')
  return {verified:true,message:'Email verified. You can now sign in.'}
}
export async function postgresResendVerification(email) {
  if(!email?.trim()) throw new ApiError(400,'Email is required')
  const c=await getPostgresPool().connect()
  try {
    const found=await c.query("SELECT id,email,email_verified FROM users WHERE email=$1",[email.trim().toLowerCase()])
    if(!found.rowCount||found.rows[0].email_verified) return {message:'If this account needs verification, a new email will be sent shortly.'}
    const raw=token(), u=found.rows[0]
    await c.query("UPDATE users SET email_verification_token_hash=$1,email_verification_expires_at=now()+interval '30 minutes' WHERE id=$2",[hash(raw),u.id])
    const url=link('verifyEmail',raw)
    await sendEmail({to:u.email,subject:'Verify your Kendram email',text:'Verify your email within 30 minutes: '+url,html:'<p><a href="'+url+'">Verify email</a></p><p>This link expires in 30 minutes.</p>'})
    return {message:'If this account needs verification, a new email will be sent shortly.'}
  } finally {c.release()}
}
export async function postgresLogin({email,password}) {
  if(!email?.trim()||!password) throw new ApiError(400,'Email and password are required')
  const r=await getPostgresPool().query("SELECT * FROM users WHERE email=$1",[email.trim().toLowerCase()])
  const u=r.rows[0]
  if(!u||u.status!=='ACTIVE'||!await bcrypt.compare(password,u.password_hash)) throw new ApiError(401,'Invalid email or password')
  if(!u.email_verified) throw new ApiError(403,'Please verify your email before signing in. Check your inbox or request a new verification email.')
  return {token:accessToken(u),user:profile(u)}
}
export async function postgresRequestReset(email) {
  if(!email?.trim()) throw new ApiError(400,'Email is required')
  const c=await getPostgresPool().connect()
  try {
    const r=await c.query("SELECT id,email FROM users WHERE email=$1 AND status='ACTIVE' AND email_verified=true",[email.trim().toLowerCase()])
    if(!r.rowCount) return {message:'If an account exists for that email, a password reset link will be sent shortly.'}
    const raw=token(),u=r.rows[0]
    await c.query("UPDATE users SET password_reset_token_hash=$1,password_reset_expires_at=now()+interval '30 minutes' WHERE id=$2",[hash(raw),u.id])
    const url=link('resetPassword',raw)
    await sendEmail({to:u.email,subject:'Reset your Kendram password',text:'Reset your password within 30 minutes: '+url,html:'<p><a href="'+url+'">Reset password</a></p><p>This link expires in 30 minutes.</p>'})
    return {message:'If an account exists for that email, a password reset link will be sent shortly.'}
  } finally {c.release()}
}
export async function postgresResetPassword(raw,password) {
  if(typeof raw!=='string'||!raw||raw.length>256) throw new ApiError(400,'A valid password reset token is required')
  if(typeof password!=='string'||password.length<8||password.length>128) throw new ApiError(400,'Password must be between 8 and 128 characters')
  const r=await getPostgresPool().query("UPDATE users SET password_hash=$1,password_reset_token_hash=NULL,password_reset_expires_at=NULL,updated_at=now() WHERE password_reset_token_hash=$2 AND password_reset_expires_at>now() AND status='ACTIVE' AND email_verified=true RETURNING id",[await bcrypt.hash(password,12),hash(raw)])
  if(!r.rowCount) throw new ApiError(400,'This password reset link is invalid or expired. Request a new one.')
  return {message:'Password reset successfully. You can now sign in.'}
}
export async function postgresAuthUserById(id) {
  const r=await getPostgresPool().query("SELECT * FROM users WHERE (id::text=$1 OR legacy_mongo_id=$1) AND status='ACTIVE'",[String(id)])
  return r.rows[0]||null
}
export async function postgresUpdateProfile(id, updates) {
  const columns={name:'name',displayName:'display_name',avatarUrl:'avatar_url',bio:'bio',location:'location',timezone:'timezone'}
  const c=await getPostgresPool().connect()
  try {
    await c.query('BEGIN')
    const found=await c.query("SELECT * FROM users WHERE (id::text=$1 OR legacy_mongo_id=$1) AND status='ACTIVE' FOR UPDATE",[String(id)])
    if(!found.rowCount) throw new ApiError(404,'Account not found')
    const sets=[],values=[]
    for(const [key,value] of Object.entries(updates)) if(columns[key]) {values.push(value);sets.push(columns[key]+'=$'+values.length)}
    if(sets.length) {values.push(found.rows[0].id);await c.query('UPDATE users SET '+sets.join(',')+',updated_at=now() WHERE id=$'+values.length,values)}
    const result=await c.query('SELECT * FROM users WHERE id=$1',[found.rows[0].id])
    await c.query('COMMIT');return profile(result.rows[0])
  } catch(e) {await c.query('ROLLBACK').catch(()=>{});throw e} finally {c.release()}
}
