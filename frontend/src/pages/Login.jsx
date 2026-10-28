import { useEffect, useState } from 'react'
import Icon from '../components/Icon'
import { useAuth } from '../auth/AuthProvider'
import { api } from '../lib/api'
import CookieConsent from '../components/CookieConsent'

export default function Login() {
  const { login, register, enterDemo } = useAuth()
  const [mode, setMode] = useState('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const isRegister = mode === 'register'
  const isReset = mode === 'reset'

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const verifyToken = params.get('verifyEmail')
    const resetToken = params.get('resetPassword')
    if (verifyToken) {
      setBusy(true)
      api.verifyEmail(verifyToken).then((result) => {
        setNotice(result.data?.message || 'Email verified. You can now sign in.')
        window.history.replaceState({}, '', window.location.pathname)
      }).catch((err) => {
        setError(err.message || 'This verification link is invalid or expired.')
        setMode('resend')
      }).finally(() => setBusy(false))
    } else if (resetToken) {
      setToken(resetToken)
      setMode('reset')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  const submit = async (event) => {
    event.preventDefault(); setError(''); setNotice('')
    if ((isRegister || isReset) && password !== confirmPassword) { setError('Passwords do not match'); return }
    setBusy(true)
    try {
      if (isRegister) {
        const result = await register({ name: name.trim(), email: email.trim(), password })
        setEmail(result.email || email.trim()); setPassword(''); setConfirmPassword(''); setMode('verify-pending')
        setNotice(result.message || 'Check your email for a verification link.')
      } else if (mode === 'forgot') {
        const result = await api.forgotPassword(email.trim())
        setNotice(result.data?.message || 'If an account exists for that email, a reset link will be sent shortly.')
      } else if (mode === 'resend') {
        const result = await api.resendVerification(email.trim())
        setNotice(result.data?.message || 'If this account needs verification, a new email will be sent shortly.')
      } else if (isReset) {
        const result = await api.resetPassword(token, password)
        setNotice(result.data?.message || 'Password reset. You can now sign in.'); setPassword(''); setConfirmPassword(''); setMode('login')
      } else await login({ email: email.trim(), password })
    } catch (err) { setError(err.message || 'Something went wrong. Please try again.') }
    finally { setBusy(false) }
  }

  const title = ({ login: 'Work with clarity.', register: 'Create your workspace account.', forgot: 'Recover your account.', resend: 'Verify your email.', reset: 'Choose a new password.', 'verify-pending': 'Check your inbox.' })[mode]
  const description = ({
    login: 'Sign in to manage projects, tasks, ownership, and team workload.',
    register: 'Create an account. We will email you a verification link before you can sign in.',
    forgot: 'Enter your account email and we will send a secure reset link if the account exists.',
    resend: 'Enter your registration email and we will send a fresh verification link.',
    reset: 'Choose a new password for your Kendram account.',
    'verify-pending': 'Open the verification link we emailed you to activate your account.',
  })[mode]

  return <div className="login-shell">
    <div className="login-glow login-glow-one" /><div className="login-glow login-glow-two" />
    <section className="login-card">
      <div className="login-brand"><span className="brand-mark" aria-hidden="true">KE</span><div><strong>Kendram</strong><small>Project & team workspace</small></div></div>
      <div className="login-copy"><span className="eyebrow">{isRegister ? 'New to Kendram' : mode === 'login' ? 'Welcome back' : 'Account security'}</span><h1>{title}</h1><p>{description}</p></div>
      {mode === 'verify-pending' ? <div className="login-form">
        <div className="login-note" role="status">Email: <strong>{email}</strong><br />The verification link expires in 30 minutes. Check your spam folder too.</div>
        {notice ? <div className="login-note">{notice}</div> : null}{error ? <div className="login-error" role="alert">{error}</div> : null}
        <button className="login-submit" type="button" disabled={busy} onClick={async () => { setBusy(true); setError(''); setNotice(''); try { const r = await api.resendVerification(email.trim()); setNotice(r.data?.message || 'If this account needs verification, a new email will be sent shortly.') } catch (err) { setError(err.message) } finally { setBusy(false) } }}>{busy ? 'Sending…' : 'Resend verification email'}</button>
        <button className="auth-switch-button" type="button" onClick={() => { setMode('login'); setNotice(''); setError('') }}>Back to sign in</button>
      </div> : <form className="login-form" onSubmit={submit}>
        {isRegister ? <label className="field"><span>Full name</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" minLength="2" maxLength="80" required /></label> : null}
        <label className="field"><span>Email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" maxLength="254" required /></label>
        {mode === 'login' || isRegister || isReset ? <label className="field"><span>{isReset ? 'New password' : 'Password'}</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete={isReset || isRegister ? 'new-password' : 'current-password'} minLength="8" maxLength="128" required /></label> : null}
        {isRegister || isReset ? <label className="field"><span>Confirm password</span><input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter your password" autoComplete="new-password" minLength="8" maxLength="128" required /></label> : null}
        {error ? <div className="login-error" role="alert">{error}</div> : null}{notice ? <div className="login-note" role="status">{notice}</div> : null}
        <button className="login-submit" type="submit" disabled={busy}><Icon name="spark" size={15} />{busy ? 'Please wait…' : isRegister ? 'Create account' : mode === 'forgot' ? 'Send reset link' : mode === 'resend' ? 'Send verification email' : isReset ? 'Reset password' : 'Sign in'}</button>
      </form>}
      {mode === 'login' ? <>
        <button className="auth-switch-button" type="button" onClick={() => { setMode('forgot'); setError(''); setNotice('') }}>Forgot password?</button>
        <button className="auth-switch-button" type="button" onClick={() => { setMode('resend'); setError(''); setNotice('') }}>Resend verification email</button>
        <button className="auth-switch-button" type="button" onClick={() => { setMode('register'); setError(''); setNotice(''); setPassword(''); setConfirmPassword('') }}>New here? Create an account</button>
        <div className="login-divider"><span>or</span></div><button className="demo-button" type="button" onClick={enterDemo}>Preview demo workspace <span>→</span></button>
      </> : mode === 'register' ? <button className="auth-switch-button" type="button" onClick={() => { setMode('login'); setError(''); setNotice('') }}>Already have an account? Sign in</button> : mode !== 'verify-pending' ? <button className="auth-switch-button" type="button" onClick={() => { setMode('login'); setError(''); setNotice(''); setPassword(''); setConfirmPassword('') }}>Back to sign in</button> : null}
      <p className="login-note">{isRegister ? 'You must verify your email before signing in.' : mode === 'login' ? 'Demo mode uses local mock data. Sign in uses the Kendram API.' : 'For your security, verification and reset links expire after 30 minutes.'}</p>
    </section>
    <div className="login-footer"><span>Kendram</span><span>Designed for focused team execution</span><nav className="login-legal-links" aria-label="Legal"><a href="/privacy-policy">Privacy Policy</a><a href="/terms-and-conditions">Terms &amp; Conditions</a></nav></div><CookieConsent />
  </div>
}
