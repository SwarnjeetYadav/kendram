import { useState } from 'react'
import Badge from './Badge'
import Icon from './Icon'
import { api } from '../lib/api'

function roleLabel(value = 'MEMBER') {
  return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default function InvitationInbox({ invitations = [], onChanged }) {
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')

  if (!invitations.length) return null

  const respond = async (invitation, action) => {
    setBusyId(invitation._id)
    setError('')
    try {
      await api.respondToInvitation(invitation._id, action)
      onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId('')
    }
  }

  return (
    <section className="panel invitation-inbox">
      <div className="workspace-section-head">
        <div><span className="eyebrow">Pending access</span><h3>Project invitations</h3><p>Review team access requests and join the work directly.</p></div>
        <Badge color="violet">{invitations.length} pending</Badge>
      </div>
      <div className="invitation-list">
        {invitations.map((invitation) => (
          <div className="invitation-row" key={invitation._id}>
            <span className="invitation-icon"><Icon name="users" size={17} /></span>
            <div>
              <strong>{invitation.projectId?.name || 'Project'}</strong>
              <p>{invitation.invitedBy?.name || 'Project manager'} invited you as {roleLabel(invitation.projectRole)}.</p>
              <small>Expires {new Date(invitation.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</small>
            </div>
            <div className="invitation-actions">
              <button className="secondary-button" type="button" onClick={() => respond(invitation, 'DECLINE')} disabled={busyId === invitation._id}>Decline</button>
              <button className="primary-button primary-button-dark" type="button" onClick={() => respond(invitation, 'ACCEPT')} disabled={busyId === invitation._id}>{busyId === invitation._id ? 'Saving...' : 'Accept'}</button>
            </div>
          </div>
        ))}
      </div>
      {error ? <div className="workspace-error-banner">{error}</div> : null}
    </section>
  )
}
