import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Avatar from './Avatar'
import Badge from './Badge'
import Icon from './Icon'
import { api, CHAT_SOCKET_URL } from '../lib/api'
import { io } from 'socket.io-client'

const ROLE_OPTIONS = [
  ['PROJECT_MANAGER', 'Project Manager'],
  ['MEMBER', 'Team Member'],
  ['VIEWER', 'Viewer'],
]

function roleLabel(role) {
  return ROLE_OPTIONS.find(([value]) => value === role)?.[1] || role?.replaceAll('_', ' ') || 'Team Member'
}

function initialsFor(name = 'Anvaya') {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

function timeLabel(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function chatReadKey(projectId) {
  return 'anvaya_chat_read_' + projectId
}

function chatCacheKey(projectId) {
  return 'anvaya_chat_cache_' + projectId
}

function readChatCache(projectId) {
  try {
    const raw = localStorage.getItem(chatCacheKey(projectId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.slice(-60) : []
  } catch {
    return []
  }
}

function writeChatCache(projectId, messages) {
  try {
    localStorage.setItem(chatCacheKey(projectId), JSON.stringify((messages || []).filter((item) => !item.pending).slice(-60)))
  } catch {
    // Cache is an optimization only.
  }
}

function getStoredReadAt(projectId) {
  try {
    return Number(localStorage.getItem(chatReadKey(projectId)) || 0)
  } catch {
    return 0
  }
}

function setStoredReadAt(projectId, value) {
  try {
    localStorage.setItem(chatReadKey(projectId), String(value))
  } catch {
    // Ignore storage restrictions; chat remains usable for the current session.
  }
}

function unreadCountFor(messages, currentUserId, readAt) {
  return messages.filter((item) => {
    const messageTime = new Date(item.createdAt).getTime()
    return Number.isFinite(messageTime)
      && messageTime > readAt
      && String(item.userId?._id) !== String(currentUserId)
  }).length
}

function ChatMessages({ messages, currentUserId, loading, onReply, onReact, onCopy }) {
  if (loading && !messages.length) {
    return <div className="comment-empty team-chat-loading-state">Loading team conversation...</div>
  }

  if (!loading && !messages.length) {
    return <div className="comment-empty team-chat-loading-state">No messages yet. Start the conversation for this project.</div>
  }

  return messages.map((item) => {
    const ownMessage = String(item.userId?._id) === String(currentUserId)
    const reactionCounts = (item.reactions || []).reduce((map, reaction) => {
      map[reaction.emoji] = (map[reaction.emoji] || 0) + 1
      return map
    }, {})

    return (
      <div className={'team-chat-message ' + (ownMessage ? 'team-chat-message-self' : '')} key={item._id}>
        <Avatar initials={initialsFor(item.userId?.name)} color={ownMessage ? 'violet' : 'blue'} size="sm" />
        <div className="team-chat-message-body">
          <div className="team-chat-message-head">
            <strong>{item.userId?.name || 'Team member'}</strong>
            <span>{timeLabel(item.createdAt)}</span>
          </div>
          {item.replyToId ? (
            <div className="chat-reply-preview"><strong>Replying to {item.replyToId.userId?.name || 'team member'}</strong><span>{item.replyToId.message}</span></div>
          ) : null}
          {item.taskId ? (
            <div className="chat-task-context"><Icon name="link" size={12} /><span>{item.taskId.title}</span></div>
          ) : null}
          <p>{item.message}</p>
          <div className="chat-message-actions">
            <button type="button" onClick={() => onReply?.(item)} aria-label="Reply to message">Reply</button>
            <button type="button" onClick={() => onCopy?.(item.message)} aria-label="Copy message">Copy</button>
            {['👍', '✅', '❤️'].map((emoji) => (
              <button type="button" key={emoji} onClick={() => onReact?.(item, emoji)} aria-label={'React ' + emoji}>{emoji}{reactionCounts[emoji] ? ' ' + reactionCounts[emoji] : ''}</button>
            ))}
          </div>
          {item.mentions?.length ? <small className="chat-mentions">Mentioned: {item.mentions.map((person) => '@' + person.name).join(', ')}</small> : null}
        </div>
      </div>
    )
  })
}

export default function TeamWorkspace({ projects, membersByProject, currentUserId, currentUser, onChanged }) {
  const [projectId, setProjectId] = useState(projects[0]?._id || '')
  const [query, setQuery] = useState('')
  const [projectRole, setProjectRole] = useState('MEMBER')
  const [projectInvitations, setProjectInvitations] = useState([])
  const [candidates, setCandidates] = useState([])
  const [searching, setSearching] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const [chat, setChat] = useState([])
  const chatMessagesRef = useRef(null)
  const chatIdsRef = useRef(new Set())
  const [chatLoading, setChatLoading] = useState(false)
  const [chatMessage, setChatMessage] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatSearchOpen, setChatSearchOpen] = useState(false)
  const [chatSearch, setChatSearch] = useState('')
  const [chatNotice, setChatNotice] = useState('')
  const [chatFullscreen, setChatFullscreen] = useState(false)
  const [chatUnread, setChatUnread] = useState(0)
  const [chatReplyTo, setChatReplyTo] = useState(null)
  const [mentionIds, setMentionIds] = useState([])

  useEffect(() => {
    if (!projectId && projects[0]?._id) setProjectId(projects[0]._id)
    if (projectId && !projects.some((project) => project._id === projectId)) {
      setProjectId(projects[0]?._id || '')
    }
  }, [projects, projectId])

  const selectedProject = projects.find((project) => project._id === projectId)
  const visibleChat = useMemo(() => {
    const term = chatSearch.trim().toLowerCase()
    if (!term) return chat
    return chat.filter((item) => [item.message, item.userId?.name, item.replyToId?.message].some((value) => String(value || '').toLowerCase().includes(term)))
  }, [chat, chatSearch])
  const currentMembers = membersByProject?.[projectId] || []

  const currentMembership = currentMembers.find(
    (member) => String(member.id) === String(currentUserId),
  )

  const canManage = currentUser?.role === 'ADMINISTRATOR'
    || String(selectedProject?.ownerId) === String(currentUserId)
    || currentMembership?.projectRole === 'PROJECT_MANAGER'

  const memberStats = useMemo(() => ({
    total: currentMembers.length,
    managers: currentMembers.filter((member) => member.projectRole === 'PROJECT_MANAGER' || String(member.id) === String(selectedProject?.ownerId)).length,
    contributors: currentMembers.filter((member) => member.projectRole === 'MEMBER').length,
    viewers: currentMembers.filter((member) => member.projectRole === 'VIEWER').length,
  }), [currentMembers, selectedProject])

  useEffect(() => {
    setCandidates([])
    setMessage('')
    setError('')

    const term = query.trim()
    if (term.length < 2 || !projectId || !canManage) return undefined

    let cancelled = false
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const result = await api.searchMemberCandidates(projectId, term)
        if (!cancelled) setCandidates(result.data || [])
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, projectId, canManage])

  const loadChat = useCallback(async ({ preserveUnread = false, silent = false } = {}) => {
    if (!projectId) return

    if (!silent) setChatLoading(true)
    try {
      const result = await api.listProjectChat(projectId)
      const messages = Array.isArray(result.data) ? result.data : []
      setChat((current) => {
        const pending = current.filter((item) => item.pending)
        const incoming = messages.filter((item) => !pending.some((item2) => item2._id === item._id))
        const next = [...incoming, ...pending]
        writeChatCache(projectId, next)
        return next
      })

      const latestTime = messages.length
        ? new Date(messages[messages.length - 1].createdAt).getTime()
        : 0
      const storedReadAt = getStoredReadAt(projectId)

      if (chatOpen || !preserveUnread) {
        const readAt = Math.max(storedReadAt, latestTime)
        setStoredReadAt(projectId, readAt)
        setChatUnread(0)
      } else if (!storedReadAt && latestTime) {
        setStoredReadAt(projectId, latestTime)
        setChatUnread(0)
      } else {
        setChatUnread(unreadCountFor(messages, currentUserId, storedReadAt))
      }
    } catch (err) {
      if (!silent) setError(err.message)
    } finally {
      if (!silent) setChatLoading(false)
    }
  }, [projectId, currentUserId, chatOpen])

  useEffect(() => {
    if (!projectId) return undefined
    const cached = readChatCache(projectId)
    chatIdsRef.current = new Set(cached.map((item) => String(item._id)))
    setChat(cached)
    loadChat({ preserveUnread: true, silent: cached.length > 0 })
  }, [projectId, loadChat])

  useEffect(() => {
    if (!projectId) return undefined

    const token = localStorage.getItem('teamflow_token')
    if (!token) return undefined

    const socket = io(CHAT_SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    })

    const joinProject = () => {
      socket.emit('project:join', { projectId }, (result) => {
        if (!result?.ok) setError(result?.message || 'Unable to connect to project chat')
      })
    }

    const receiveMessage = (incoming) => {
      if (!incoming?._id) return
      const id = String(incoming._id)
      const isNew = !chatIdsRef.current.has(id)
      chatIdsRef.current.add(id)

      setChat((current) => {
        const existingIndex = current.findIndex((item) => String(item._id) === id)
        let next
        if (existingIndex >= 0) {
          next = current.map((item) => String(item._id) === id ? { ...item, ...incoming, pending: false } : item)
        } else {
          const pendingIndex = current.findIndex((item) =>
            item.pending
            && String(item.userId?._id) === String(incoming.userId?._id)
            && item.message === incoming.message,
          )
          if (pendingIndex >= 0) {
            next = current.map((item, index) => index === pendingIndex ? { ...incoming, pending: false } : item)
          } else {
            next = [...current, incoming]
          }
        }
        next.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        writeChatCache(projectId, next)
        return next
      })

      if (isNew && String(incoming.userId?._id) !== String(currentUserId)) {
        if (chatOpen) {
          setStoredReadAt(projectId, new Date(incoming.createdAt).getTime())
          setChatUnread(0)
        } else {
          setChatUnread((count) => count + 1)
        }
      }
    }

    const receiveReaction = (incoming) => {
      if (!incoming?._id) return
      setChat((current) => {
        const next = current.map((item) => String(item._id) === String(incoming._id) ? { ...item, ...incoming } : item)
        writeChatCache(projectId, next)
        return next
      })
    }

    socket.on('connect', joinProject)
    socket.on('chat:message', receiveMessage)
    socket.on('chat:reaction', receiveReaction)
    socket.on('connect_error', (connectionError) => {
      console.warn('Team chat realtime connection unavailable:', connectionError.message)
    })

    return () => {
      socket.emit('project:leave', { projectId })
      socket.off('connect', joinProject)
      socket.off('chat:message', receiveMessage)
      socket.off('chat:reaction', receiveReaction)
      socket.disconnect()
    }
  }, [projectId, currentUserId, chatOpen])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const container = chatMessagesRef.current
      if (!container) return
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [chat.length, chatOpen, chatFullscreen])

  useEffect(() => {
    if (!projectId || !canManage) {
      setProjectInvitations([])
      return undefined
    }

    let cancelled = false
    api.listProjectInvitations(projectId)
      .then((result) => {
        if (!cancelled) setProjectInvitations(result.data || [])
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => { cancelled = true }
  }, [projectId, canManage])

  useEffect(() => {
    if (!chatOpen || !projectId) return
    const latest = chat.length ? new Date(chat[chat.length - 1].createdAt).getTime() : Date.now()
    setStoredReadAt(projectId, latest)
    setChatUnread(0)
  }, [chatOpen, projectId])

  useEffect(() => {
    if (!chatFullscreen || !chatOpen) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [chatFullscreen, chatOpen])

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && chatOpen) {
        setChatFullscreen(false)
        setChatOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [chatOpen])

  const add = async (member) => {
    setBusyId(member._id)
    setError('')
    setMessage('')
    try {
      await api.addMember(projectId, member._id, projectRole)
      setMessage(member.name + ' added as ' + roleLabel(projectRole) + '.')
      setCandidates((items) => items.filter((item) => item._id !== member._id))
      setQuery('')
      onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId('')
    }
  }

  const invite = async (member) => {
    setBusyId(member._id)
    setError('')
    setMessage('')
    try {
      await api.createProjectInvitation(projectId, member._id, projectRole)
      setCandidates((items) => items.filter((item) => item._id !== member._id))
      setQuery('')
      const result = await api.listProjectInvitations(projectId)
      setProjectInvitations(result.data || [])
      setMessage(member.name + ' was invited as ' + roleLabel(projectRole) + '.')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId('')
    }
  }

  const changeRole = async (member, nextRole) => {
    setBusyId(member.id)
    setError('')
    setMessage('')
    try {
      await api.updateMemberRole(projectId, member.id, nextRole)
      setMessage(member.name + ' is now a ' + roleLabel(nextRole) + '.')
      onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId('')
    }
  }

  const remove = async (member) => {
    if (!window.confirm('Remove ' + member.name + ' from ' + selectedProject?.name + '?')) return

    setBusyId(member.id)
    setError('')
    setMessage('')
    try {
      await api.removeMember(projectId, member.id)
      setMessage(member.name + ' was removed from the project.')
      onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId('')
    }
  }

  const sendChat = async (event) => {
    event.preventDefault()
    const clean = chatMessage.trim()
    if (!clean || !projectId || chatSending) return

    const tempId = 'pending-' + Date.now()
    const replyContext = chatReplyTo
    const optimisticMessage = {
      _id: tempId,
      projectId,
      userId: {
        _id: currentUserId,
        name: currentUser?.name || 'You',
        email: currentUser?.email || '',
        role: currentUser?.role || 'TEAM_MEMBER',
      },
      message: clean,
      createdAt: new Date().toISOString(),
      replyToId: replyContext ? {
        _id: replyContext._id,
        userId: replyContext.userId,
        message: replyContext.message,
        createdAt: replyContext.createdAt,
      } : null,
      mentions: [],
      reactions: [],
      pending: true,
    }

    setChat((items) => {
      const next = [...items, optimisticMessage]
      writeChatCache(projectId, next)
      return next
    })
    setChatMessage('')
    setChatReplyTo(null)
    setMentionIds([])
    setStoredReadAt(projectId, Date.now())
    setChatUnread(0)
    setChatSending(true)
    setError('')

    try {
      const result = await api.sendProjectChat(projectId, clean, {
        replyToId: replyContext?._id || null,
        taskId: null,
        mentions: mentionIds,
      })
      const nextMessage = {
        ...(result.data || {}),
        _id: result.data?._id || tempId,
        pending: false,
        userId: result.data?.userId?.name ? result.data.userId : optimisticMessage.userId,
        replyToId: result.data?.replyToId || optimisticMessage.replyToId,
      }
      setChat((items) => {
        const next = items.map((item) => item._id === tempId ? nextMessage : item)
        writeChatCache(projectId, next)
        return next
      })
    } catch (err) {
      setChat((items) => items.filter((item) => item._id !== tempId))
      setChatMessage(clean)
      setError(err.message)
    } finally {
      setChatSending(false)
    }
  }

  const copyChatMessage = async (value) => {
    try {
      await navigator.clipboard.writeText(value)
      setChatNotice('Message copied')
    } catch {
      setChatNotice('Copy is not available in this browser')
    }
    window.setTimeout(() => setChatNotice(''), 1800)
  }

  const reactChat = async (item, emoji) => {
    try {
      const result = await api.reactProjectChat(projectId, item._id, emoji)
      setChat((items) => items.map((current) => current._id === item._id ? result.data : current))
    } catch (err) {
      setError(err.message)
    }
  }

  const mentionCandidates = useMemo(() => {
    const clean = chatMessage.match(/@([a-zA-Z0-9_ ]{0,30})$/)?.[1]?.trim().toLowerCase()
    if (clean === undefined) return []
    return currentMembers.filter((member) =>
      String(member.id) !== String(currentUserId)
      && member.name.toLowerCase().includes(clean),
    ).slice(0, 5)
  }, [chatMessage, currentMembers, currentUserId])

  const openChat = () => {
    setChatOpen(true)
    setChatFullscreen(false)
    setStoredReadAt(projectId, chat.length ? new Date(chat[chat.length - 1].createdAt).getTime() : Date.now())
    setChatUnread(0)
  }

  const minimizeChat = () => {
    setChatFullscreen(false)
    setChatOpen(false)
  }

  return (
    <div className="team-workspace">
      <div className="team-workspace-toolbar">
        <div>
          <span className="eyebrow">Team workspace</span>
          <h2>Manage your project team</h2>
          <p>Add teammates, control project permissions, and keep the team conversation in one place.</p>
        </div>
        <select value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label="Select project team">
          {projects.map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}
        </select>
      </div>

      {selectedProject ? (
        <>
          <div className="team-metrics">
            <div><strong>{memberStats.total}</strong><span>Team members</span></div>
            <div><strong>{memberStats.managers}</strong><span>Project managers</span></div>
            <div><strong>{memberStats.contributors}</strong><span>Contributors</span></div>
            <div><strong>{memberStats.viewers}</strong><span>Viewers</span></div>
          </div>

          {!canManage ? (
            <div className="permission-notice">
              <Icon name="settings" size={15} />
              <div><strong>Project permissions are managed by the owner or project manager.</strong><span>You can still see the team and use project chat.</span></div>
            </div>
          ) : null}

          <div className="team-management-grid">
            <section className="panel">
              <div className="team-section-head">
                <div><span className="eyebrow">Membership</span><h3>Current team</h3><p>Manage access for people in {selectedProject.name}.</p></div>
                <Badge color={canManage ? 'green' : 'blue'}>{canManage ? 'Manager access' : 'Read access'}</Badge>
              </div>

              <div className="team-member-list">
                {currentMembers.length ? currentMembers.map((member) => {
                  const owner = String(member.id) === String(selectedProject.ownerId)
                  const self = String(member.id) === String(currentUserId)
                  const memberBusy = busyId === member.id

                  return (
                    <div className="team-member-row" key={member.memberId || member.id}>
                      <Avatar initials={member.initials} color={member.tone} size="sm" />
                      <div className="team-member-main">
                        <div><strong>{member.name}</strong>{owner ? <Badge color="violet">Owner</Badge> : null}</div>
                        <small>{member.email}</small>
                      </div>
                      <select
                        className="team-role-select"
                        value={owner ? 'PROJECT_MANAGER' : (member.projectRole || 'MEMBER')}
                        disabled={!canManage || owner || self || memberBusy}
                        onChange={(event) => changeRole(member, event.target.value)}
                        aria-label={'Project role for ' + member.name}
                      >
                        {ROLE_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                      </select>
                      {owner ? (
                        <span className="team-protected">Protected</span>
                      ) : canManage ? (
                        <button className="danger-outline-button" type="button" onClick={() => remove(member)} disabled={memberBusy || self}>
                          {memberBusy ? 'Saving...' : 'Remove'}
                        </button>
                      ) : null}
                    </div>
                  )
                }) : <div className="empty-state">No members have been added to this project yet.</div>}
              </div>
            </section>

            <section className="panel">
              <div className="team-section-head">
                <div><span className="eyebrow">Access control</span><h3>Add a teammate</h3><p>Search active Anvaya users and give them project-specific access.</p></div>
              </div>

              {canManage ? (
                <>
                  <div className="team-add-controls">
                    <input className="member-search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or email..." aria-label="Search users to add" />
                    <select value={projectRole} onChange={(event) => setProjectRole(event.target.value)} aria-label="New member project role">
                      {ROLE_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                    </select>
                  </div>
                  {searching ? <div className="comment-empty">Searching users...</div> : null}
                  {!searching && query.trim().length >= 2 && !candidates.length ? <div className="comment-empty">No active users available.</div> : null}
                  <div className="team-candidate-list">
                    {candidates.map((member) => (
                      <div className="team-candidate-row" key={member._id}>
                        <Avatar initials={initialsFor(member.name)} color="violet" size="sm" />
                        <div><strong>{member.name}</strong><small>{member.email} · {roleLabel(member.role)}</small></div>
                        <div className="candidate-actions">
                          <button className="small-action-button" type="button" onClick={() => add(member)} disabled={busyId === member._id}>{busyId === member._id ? 'Adding...' : 'Add now'}</button>
                          <button className="secondary-small-button" type="button" onClick={() => invite(member)} disabled={busyId === member._id}>Invite</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="permission-cards">
                    <div><strong>Project Manager</strong><span>Manage members, roles, tasks, and project work.</span></div>
                    <div><strong>Team Member</strong><span>Create and update tasks, collaborate, and use chat.</span></div>
                    <div><strong>Viewer</strong><span>Read project work without changing tasks.</span></div>
                  </div>
                  <div className="pending-invitations-panel">
                    <div className="workspace-section-head"><div><span className="eyebrow">Onboarding</span><h4>Pending invitations</h4><p>Invites expire after 7 days and never create duplicate memberships.</p></div><Badge color={projectInvitations.length ? 'violet' : 'neutral'}>{projectInvitations.length} pending</Badge></div>
                    {projectInvitations.length ? projectInvitations.filter((item) => item.status === 'PENDING').map((item) => (
                      <div className="pending-invitation-row" key={item._id}>
                        <div><strong>{item.invitedUserId?.name || 'User'}</strong><small>{item.invitedUserId?.email || ''} · {roleLabel(item.projectRole)}</small></div>
                        <span>Expires {new Date(item.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                      </div>
                    )) : <div className="detail-empty">No pending invitations for this project.</div>}
                  </div>
                </>
              ) : (
                <div className="permission-summary">
                  <div><strong>Your project role</strong><span>{String(selectedProject.ownerId) === String(currentUserId) ? 'Owner' : roleLabel(currentMembership?.projectRole)}</span></div>
                  <div><strong>Access</strong><span>{String(selectedProject.ownerId) === String(currentUserId) || currentMembership?.projectRole !== 'VIEWER' ? 'Collaborative' : 'Read only'}</span></div>
                  <div><strong>Management</strong><span>Owner / project managers only</span></div>
                </div>
              )}
            </section>
          </div>
        </>
      ) : (
        <div className="empty-state">No project is available for team management yet.</div>
      )}

      {message ? <div className="success-banner">{message}</div> : null}
      {error ? <div className="login-error">{error}</div> : null}

      {selectedProject ? (
        <>
          {chatOpen && chatFullscreen ? <div className="team-chat-backdrop" onClick={minimizeChat} aria-hidden="true" /> : null}

          {!chatOpen ? (
            <button
              className="team-chat-launcher"
              type="button"
              onClick={openChat}
              aria-label={'Open ' + selectedProject.name + ' team chat'}
              title="Open team chat"
            >
              <Icon name="chat" size={24} stroke={1.8} />
              {chatUnread > 0 ? <span className="team-chat-unread">{chatUnread > 99 ? '99+' : chatUnread}</span> : null}
              <span className="sr-only">Open team chat</span>
            </button>
          ) : (
            <aside className={'team-chat-drawer ' + (chatFullscreen ? 'team-chat-drawer-fullscreen' : '')} aria-label="Team chat">
              <div className="team-chat-drawer-header">
                <div className="team-chat-drawer-title">
                  <div className="team-chat-drawer-icon"><Icon name="chat" size={17} /></div>
                  <div>
                    <strong>Team chat</strong>
                    <span>{selectedProject.name}</span>
                  </div>
                </div>

                <div className="team-chat-drawer-actions">
                  <button type="button" className="team-chat-icon-button" onClick={() => { setChatSearchOpen((value) => !value); setChatSearch('') }} aria-label={chatSearchOpen ? 'Close message search' : 'Search messages'} title="Search messages">
                    <Icon name="search" size={16} />
                  </button>
                  <button type="button" className="team-chat-icon-button" onClick={() => loadChat({ preserveUnread: true })} disabled={chatLoading} aria-label="Refresh team chat" title="Refresh chat">
                    <Icon name="refresh" size={16} />
                  </button>
                  <button
                    type="button"
                    className="team-chat-icon-button"
                    onClick={() => setChatFullscreen((value) => !value)}
                    aria-label={chatFullscreen ? 'Exit full screen chat' : 'Open full screen chat'}
                    title={chatFullscreen ? 'Exit full screen' : 'Full screen'}
                  >
                    <Icon name={chatFullscreen ? 'minimize' : 'expand'} size={16} />
                  </button>
                  <button type="button" className="team-chat-icon-button team-chat-close-button" onClick={minimizeChat} aria-label="Minimize chat" title="Minimize chat">
                    <Icon name="close" size={16} />
                  </button>
                </div>
              </div>

              {chatSearchOpen ? <div className="team-chat-searchbar"><Icon name="search" size={16} /><input autoFocus value={chatSearch} onChange={(event) => setChatSearch(event.target.value)} placeholder="Search messages or people…" aria-label="Search messages" /><button type="button" onClick={() => { setChatSearch(''); setChatSearchOpen(false) }} aria-label="Close search"><Icon name="close" size={15} /></button></div> : null}

              <div className="team-chat-drawer-meta">
                <div>
                  <span>{currentMembers.length} member{currentMembers.length === 1 ? '' : 's'}</span>
                  <i />
                  <span>{selectedProject.status?.replaceAll('_', ' ') || 'Active'}</span>
                </div>
                <small>Messages are shared with this project team.</small>
              </div>

              <div className="team-chat-drawer-messages" ref={chatMessagesRef}>
                <ChatMessages messages={visibleChat} currentUserId={currentUserId} loading={chatLoading} onReply={(item) => setChatReplyTo(item)} onReact={reactChat} onCopy={copyChatMessage} />
              </div>

              {chatReplyTo ? (
                <div className="chat-reply-composer">
                  <div><strong>Replying to {chatReplyTo.userId?.name || 'team member'}</strong><span>{chatReplyTo.message}</span></div>
                  <button type="button" className="team-chat-icon-button" onClick={() => setChatReplyTo(null)} aria-label="Cancel reply"><Icon name="close" size={14} /></button>
                </div>
              ) : null}
              {mentionCandidates.length ? (
                <div className="chat-mention-menu">
                  {mentionCandidates.map((member) => (
                    <button type="button" key={member.id} onClick={() => {
                      const clean = chatMessage.replace(/@([a-zA-Z0-9_ ]{0,30})$/, '').trimEnd()
                      setChatMessage(clean + ' @' + member.name + ' ')
                      setMentionIds((ids) => ids.includes(member.id) ? ids : [...ids, member.id])
                    }}>
                      <Avatar initials={member.initials} color={member.tone} size="sm" />
                      <span><strong>{member.name}</strong><small>{roleLabel(member.projectRole)}</small></span>
                    </button>
                  ))}
                </div>
              ) : null}
              {chatNotice ? <div className="team-chat-notice" role="status">{chatNotice}</div> : null}
              <form className="team-chat-drawer-form" onSubmit={sendChat}>
                <input
                  value={chatMessage}
                  onChange={(event) => {
                    const next = event.target.value
                    setChatMessage(next)
                    if (!next.includes('@')) setMentionIds([])
                  }}
                  placeholder={chatReplyTo ? 'Write a reply...' : 'Message your project team...'}
                  maxLength={2000}
                  aria-label="Team chat message"
                />
                <button
                  className="team-chat-send-button"
                  type="submit"
                  disabled={chatSending || !chatMessage.trim()}
                  aria-label="Send message"
                  title="Send message"
                >
                  <Icon name="send" size={16} />
                </button>
              </form>
              <div className="team-chat-drawer-footer">Press Esc to minimize · Live updates enabled</div>
            </aside>
          )}
        </>
      ) : null}
    </div>
  )
}
