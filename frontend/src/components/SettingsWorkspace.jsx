import { useEffect, useState } from 'react'
import Badge from './Badge'
import Icon from './Icon'
import { api } from '../lib/api'
import { useAuth } from '../auth/AuthProvider'

const NOTIFICATION_OPTIONS = [
  ['taskAssignment', 'Task assignments', 'Get notified when a task is assigned or reassigned to you.'],
  ['projectInvitation', 'Project invitations', 'Receive invitations and invitation status updates.'],
  ['chatMention', 'Team chat mentions', 'Get notified when someone mentions you in project chat.'],
  ['dependencyUnblocked', 'Dependency updates', 'Know when blocking work completes and your task can continue.'],
  ['teamUpdates', 'Team updates', 'Receive membership and project access updates.'],
]

export default function SettingsWorkspace({ user, projectCount = 0, taskCount = 0 }) {
  const { updateUser } = useAuth()
  const [profile, setProfile] = useState(() => ({ name: user?.name || '', displayName: user?.displayName || '', avatarUrl: user?.avatarUrl || '', bio: user?.bio || '', location: user?.location || '', timezone: user?.timezone || 'Asia/Kolkata' }))
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMessage, setProfileMessage] = useState('')
  const [profileError, setProfileError] = useState('')
  const [preferences, setPreferences] = useState(null)
  const [saving, setSaving] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    api.getPreferences()
      .then((result) => {
        if (!cancelled) setPreferences(result.data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.density = preferences?.display?.compactMode ? 'compact' : 'comfortable'
    return () => { delete document.documentElement.dataset.density }
  }, [preferences?.display?.compactMode])

  const updatePreference = async (section, key, value) => {
    const next = {
      ...preferences,
      [section]: { ...preferences[section], [key]: value },
    }
    setPreferences(next)
    setSaving(section + ':' + key)
    setMessage('')
    setError('')
    try {
      const result = await api.updatePreferences({ [section]: { [key]: value } })
      setPreferences(result.data)
      setMessage('Preference saved.')
    } catch (err) {
      setError(err.message)
      setPreferences((current) => current ? { ...current, [section]: { ...current[section], [key]: !value } } : current)
    } finally {
      setSaving('')
    }
  }

  if (!preferences) {
    return <div className="panel"><div className="workspace-inline-status">Loading account preferences...</div></div>
  }

  return (
    <div className="settings-workspace">
      <section className="panel settings-profile-panel kendram-profile-panel">
        <div className="workspace-section-head"><div><span className="eyebrow">Your account</span><h3>Profile settings</h3><p>Make your identity easy for your teammates to recognize.</p></div><Icon name="user" size={20} /></div>
        <form className="kendram-profile-form" onSubmit={async (event) => { event.preventDefault(); setProfileSaving(true); setProfileMessage(''); setProfileError(''); try { const result = await api.updateProfile(profile); updateUser(result.data); setProfile(result.data); setProfileMessage('Your profile has been saved.') } catch (err) { setProfileError(err.message || 'Could not save your profile.') } finally { setProfileSaving(false) } }}>
          <div className="kendram-profile-identity">{profile.avatarUrl ? <img className="kendram-profile-avatar" src={profile.avatarUrl} alt="Profile preview" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : <div className="kendram-profile-avatar kendram-profile-avatar-fallback">{(profile.displayName || profile.name || 'K').trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</div>}<div className="kendram-profile-avatar-copy"><strong>Profile photo</strong><span>Paste a public HTTPS image URL. Square images work best.</span></div>{profile.avatarUrl ? <button className="kendram-profile-remove-photo" type="button" onClick={() => setProfile((current) => ({ ...current, avatarUrl: '' }))}>Remove</button> : null}</div>
          <label className="kendram-profile-field"><span>Profile image URL</span><input type="url" value={profile.avatarUrl} maxLength={2048} placeholder="https://example.com/your-photo.jpg" onChange={(event) => setProfile((current) => ({ ...current, avatarUrl: event.target.value }))} /><small>Use a secure HTTPS link to an image.</small></label>
          <div className="kendram-profile-fields-grid">
            <label className="kendram-profile-field"><span>Full name <b>*</b></span><input required maxLength={80} value={profile.name} placeholder="Your full name" onChange={(event) => setProfile((current) => ({ ...current, name: event.target.value }))} /></label>
            <label className="kendram-profile-field"><span>Display name</span><input maxLength={50} value={profile.displayName} placeholder="How teammates see you" onChange={(event) => setProfile((current) => ({ ...current, displayName: event.target.value }))} /><small>Optional preferred name.</small></label>
            <label className="kendram-profile-field"><span>Email address</span><input value={user?.email || ''} disabled /><small>Email changes are disabled for account security.</small></label>
            <label className="kendram-profile-field"><span>Role</span><input value={(user?.role || 'TEAM_MEMBER').replaceAll('_', ' ')} disabled /></label>
            <label className="kendram-profile-field"><span>Location</span><input maxLength={80} value={profile.location} placeholder="e.g. Patna, India" onChange={(event) => setProfile((current) => ({ ...current, location: event.target.value }))} /></label>
            <label className="kendram-profile-field"><span>Time zone</span><select value={profile.timezone} onChange={(event) => setProfile((current) => ({ ...current, timezone: event.target.value }))}><option value="Asia/Kolkata">India Standard Time (IST)</option><option value="UTC">UTC</option><option value="Asia/Dubai">Gulf Standard Time</option><option value="Europe/London">United Kingdom</option><option value="America/New_York">US Eastern</option><option value="America/Los_Angeles">US Pacific</option><option value="Asia/Singapore">Singapore</option><option value="Australia/Sydney">Australia Eastern</option></select></label>
          </div>
          <label className="kendram-profile-field"><span>About you</span><textarea maxLength={240} rows={3} value={profile.bio} placeholder="A short introduction for your team…" onChange={(event) => setProfile((current) => ({ ...current, bio: event.target.value }))} /><small>{profile.bio.length}/240 characters</small></label>
          {profileMessage ? <div className="success-banner" role="status">{profileMessage}</div> : null}{profileError ? <div className="workspace-error-banner" role="alert">{profileError}</div> : null}
          <div className="kendram-profile-actions"><button className="kendram-profile-reset" type="button" onClick={() => { setProfile({ name: user?.name || '', displayName: user?.displayName || '', avatarUrl: user?.avatarUrl || '', bio: user?.bio || '', location: user?.location || '', timezone: user?.timezone || 'Asia/Kolkata' }); setProfileMessage(''); setProfileError('') }}>Discard changes</button><button className="kendram-profile-save" type="submit" disabled={profileSaving}>{profileSaving ? 'Saving…' : 'Save profile'}</button></div>
        </form>
      </section>

      <div className="settings-grid">
        <section className="panel settings-preferences-panel">
          <div className="workspace-section-head"><div><span className="eyebrow">Notifications</span><h3>Keep the right signals</h3><p>Control the events that deserve an inbox notification.</p></div><Icon name="bell" size={19} /></div>
          <div className="preference-list">
            {NOTIFICATION_OPTIONS.map(([key, title, description]) => {
              const enabled = preferences.notifications?.[key] !== false
              return (
                <div className="preference-row" key={key}>
                  <div><strong>{title}</strong><p>{description}</p></div>
                  <button className={'preference-toggle ' + (enabled ? 'on' : '')} type="button" role="switch" aria-checked={enabled} onClick={() => updatePreference('notifications', key, !enabled)} disabled={saving === 'notifications:' + key}>
                    <span />
                  </button>
                </div>
              )
            })}
          </div>
        </section>

        <section className="panel">
          <div className="workspace-section-head"><div><span className="eyebrow">Display</span><h3>Workspace density</h3><p>Keep the interface comfortable, especially on long work sessions.</p></div></div>
          <div className="density-card">
            <div><strong>Compact mode</strong><p>Reduce secondary spacing while keeping primary text and controls readable.</p></div>
            <button className={'preference-toggle ' + (preferences.display?.compactMode ? 'on' : '')} type="button" role="switch" aria-checked={Boolean(preferences.display?.compactMode)} onClick={() => updatePreference('display', 'compactMode', !preferences.display?.compactMode)} disabled={saving === 'display:compactMode'}><span /></button>
          </div>
          <div className="workspace-stats-card"><div><span>Visible projects</span><strong>{projectCount}</strong></div><div><span>Visible tasks</span><strong>{taskCount}</strong></div></div>
        </section>
      </div>

      {message ? <div className="success-banner">{message}</div> : null}
      {error ? <div className="workspace-error-banner">{error}</div> : null}
    </div>
  )
}
