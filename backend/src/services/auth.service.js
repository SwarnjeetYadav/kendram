import bcrypt from 'bcryptjs'
import { createHash, randomBytes } from 'node:crypto'
import User from '../models/User.js'
import { ApiError } from '../utils/apiError.js'
import { signAccessToken } from '../utils/token.js'
import { env } from '../config/env.js'
const TOKEN_TTL_MS = 30 * 60 * 1000
const hashToken = (token) => createHash('sha256').update(token).digest('hex')
const makeToken = () => randomBytes(32).toString('hex')
async function sendEmail({ to, subject, html, text }) {
 if (!env.resendApiKey) throw new ApiError(503, 'Email delivery is not configured. Please contact the site administrator.')
 const response = await fetch('https://api.resend.com/emails', { method:'POST', headers:{ Authorization:'Bearer '+env.resendApiKey, 'Content-Type':'application/json' }, body:JSON.stringify({ from:env.emailFrom, to:[to], subject, html, text }) })
 if (!response.ok) { const detail = await response.text().catch(()=> ''); console.error('Email provider rejected a message',response.status,detail.slice(0,300)); throw new ApiError(502,'We could not send the email right now. Please try again shortly.') }
}
const emailLink = (key, token) => env.appUrl + '/?' + key + '=' + encodeURIComponent(token)
async function sendVerificationEmail(user, token) {
 const link=emailLink('verifyEmail',token)
 await sendEmail({to:user.email,subject:'Verify your Kendram email',text:'Verify your Kendram email within 30 minutes: '+link,html:'<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#202938"><h1>Welcome to Kendram</h1><p>Confirm your email address to activate your account.</p><p><a href="'+link+'" style="display:inline-block;padding:12px 18px;background:#b9472e;color:white;text-decoration:none;border-radius:8px">Verify email</a></p><p>This link expires in 30 minutes. If you did not create this account, ignore this email.</p></div>'})
}
export async function registerUser({name,email,password}) {
 if(!name?.trim()||!email?.trim()||!password) throw new ApiError(400,'Name, email and password are required')
 if(name.trim().length>80) throw new ApiError(400,'Name must be at most 80 characters')
 if(password.length<8||password.length>128) throw new ApiError(400,'Password must be between 8 and 128 characters')
 const normalizedEmail=email.trim().toLowerCase()
 if(await User.findOne({email:normalizedEmail})) throw new ApiError(409,'Email is already registered')
 const token=makeToken()
 const user=await User.create({name:name.trim(),email:normalizedEmail,passwordHash:await bcrypt.hash(password,12),role:'TEAM_MEMBER',emailVerified:false,emailVerificationTokenHash:hashToken(token),emailVerificationExpiresAt:new Date(Date.now()+TOKEN_TTL_MS)})
 await sendVerificationEmail(user,token)
 return {verificationRequired:true,email:user.email,message:'Account created. Check your email for a verification link; it expires in 30 minutes.'}
}
export async function verifyEmailAddress(token) {
 if(!token||typeof token!=='string'||token.length>256) throw new ApiError(400,'A valid verification token is required')
 const user=await User.findOne({emailVerificationTokenHash:hashToken(token),emailVerificationExpiresAt:{$gt:new Date()}}).select('+emailVerificationTokenHash +emailVerificationExpiresAt')
 if(!user) throw new ApiError(400,'This verification link is invalid or expired. Request a new one.')
 user.emailVerified=true;user.emailVerificationTokenHash=undefined;user.emailVerificationExpiresAt=undefined;await user.save()
 return {verified:true,message:'Email verified. You can now sign in.'}
}
export async function resendVerificationEmailForAddress(email) {
 if(!email?.trim()) throw new ApiError(400,'Email is required')
 const user=await User.findOne({email:email.trim().toLowerCase()}).select('+emailVerificationTokenHash +emailVerificationExpiresAt')
 const generic={message:'If this account needs verification, a new email will be sent shortly.'}
 if(!user||user.emailVerified) return generic
 const token=makeToken();user.emailVerificationTokenHash=hashToken(token);user.emailVerificationExpiresAt=new Date(Date.now()+TOKEN_TTL_MS);await user.save()
 await sendVerificationEmail(user,token);return generic
}
export async function requestPasswordReset(email) {
 if(!email?.trim()) throw new ApiError(400,'Email is required')
 const user=await User.findOne({email:email.trim().toLowerCase()}).select('+passwordResetTokenHash +passwordResetExpiresAt')
 const generic={message:'If an account exists for that email, a password reset link will be sent shortly.'}
 if(!user||user.status!=='ACTIVE'||!user.emailVerified) return generic
 const token=makeToken();user.passwordResetTokenHash=hashToken(token);user.passwordResetExpiresAt=new Date(Date.now()+TOKEN_TTL_MS);await user.save()
 const link=emailLink('resetPassword',token)
 await sendEmail({to:user.email,subject:'Reset your Kendram password',text:'Reset your Kendram password within 30 minutes: '+link+'\nIf you did not request this, ignore this email.',html:'<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#202938"><h1>Reset your password</h1><p>We received a request to reset your Kendram password.</p><p><a href="'+link+'" style="display:inline-block;padding:12px 18px;background:#b9472e;color:white;text-decoration:none;border-radius:8px">Reset password</a></p><p>This link expires in 30 minutes and can be used only once. If you did not request a reset, ignore this email.</p></div>'})
 return generic
}
export async function resetPassword(token,password) {
 if(!token||typeof token!=='string'||token.length>256) throw new ApiError(400,'A valid password reset token is required')
 if(typeof password!=='string'||password.length<8||password.length>128) throw new ApiError(400,'Password must be between 8 and 128 characters')
 const user=await User.findOne({passwordResetTokenHash:hashToken(token),passwordResetExpiresAt:{$gt:new Date()},status:'ACTIVE',emailVerified:true}).select('+passwordHash +passwordResetTokenHash +passwordResetExpiresAt')
 if(!user) throw new ApiError(400,'This password reset link is invalid or expired. Request a new one.')
 user.passwordHash=await bcrypt.hash(password,12);user.passwordResetTokenHash=undefined;user.passwordResetExpiresAt=undefined;await user.save()
 return {message:'Password reset successfully. You can now sign in.'}
}
export async function loginUser({email,password}) {
 if(!email?.trim()||!password) throw new ApiError(400,'Email and password are required')
 const user=await User.findOne({email:email.trim().toLowerCase()}).select('+passwordHash')
 if(!user||user.status!=='ACTIVE') throw new ApiError(401,'Invalid email or password')
 if(!await bcrypt.compare(password,user.passwordHash)) throw new ApiError(401,'Invalid email or password')
 if(!user.emailVerified) throw new ApiError(403,'Please verify your email before signing in. Check your inbox or request a new verification email.')
 return {token:signAccessToken(user),user:{id:user._id,name:user.name,displayName:user.displayName||'',email:user.email,role:user.role,avatarUrl:user.avatarUrl||'',bio:user.bio||'',location:user.location||'',timezone:user.timezone||'Asia/Kolkata'}}
}
