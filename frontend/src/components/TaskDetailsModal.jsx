import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon'
import Avatar from './Avatar'
import Badge from './Badge'
import { api } from '../lib/api'

const statusLabels = [
  ['TODO', 'Todo'],
  ['IN_PROGRESS', 'In Progress'],
  ['REVIEW', 'Review'],
  ['BLOCKED', 'Blocked'],
  ['COMPLETED', 'Completed'],
]
const priorityOptions = [
  ['LOW', 'Low'],
  ['MEDIUM', 'Medium'],
  ['HIGH', 'High'],
  ['CRITICAL', 'Critical'],
]

function memberInitials(name = 'AN') {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

function roleLabel(role = 'MEMBER') {
  return role.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default function TaskDetailsModal({
  task,
  open,
  liveMode,
  projectMembers = [],
  projectTasks = [],
  canEditTask = true,
  onClose,
  onChanged,
}) {
  const [comments, setComments] = useState([])
  const [activity, setActivity] = useState([])
  const [dependencies, setDependencies] = useState([])
  const [comment, setComment] = useState('')
  const [dependencyTaskId, setDependencyTaskId] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [title, setTitle] = useState(task?.title || '')
  const [status, setStatus] = useState(task?.statusValue || 'TODO')
  const [priority, setPriority] = useState(task?.priorityValue || 'MEDIUM')
  const [assigneeId, setAssigneeId] = useState(task?.assigneeId || '')
  const [dueDate, setDueDate] = useState(task?.dueDate ? String(task.dueDate).slice(0, 10) : '')
  const [estimateMinutes, setEstimateMinutes] = useState(task?.estimateMinutes || '')
  const [loading, setLoading] = useState(false)
  const [commentBusy, setCommentBusy] = useState(false)
  const [dependencyBusy, setDependencyBusy] = useState(false)
  const [savingField, setSavingField] = useState('')
  const [suggestionLoading, setSuggestionLoading] = useState(false)
  const [error, setError] = useState('')
  const [chatUpdate, setChatUpdate] = useState('')
  const [chatUpdateBusy, setChatUpdateBusy] = useState(false)

  useEffect(() => {
    if (!open || !task) return undefined

    setTitle(task.title || '')
    setStatus(task.statusValue || 'TODO')
    setPriority(task.priorityValue || 'MEDIUM')
    setAssigneeId(task.assigneeId || '')
    setDueDate(task.dueDate ? String(task.dueDate).slice(0, 10) : '')
    setEstimateMinutes(task.estimateMinutes || '')
    setComment('')
    setDependencyTaskId('')
    setError('')
    setSuggestions([])
    setComments([])
    setActivity([])
    setDependencies([])

    if (!liveMode || !task.apiId) return undefined

    let cancelled = false
    setLoading(true)
    setSuggestionLoading(true)

    Promise.all([
      api.listComments(task.apiId),
      api.listTaskActivity(task.apiId),
      api.listTaskDependencies(task.apiId),
      api.getAssignmentSuggestions(task.apiId),
    ])
      .then(([commentsResult, activityResult, dependencyResult, suggestionResult]) => {
        if (cancelled) return
        setComments(commentsResult.data || [])
        setActivity(activityResult.data || [])
        setDependencies(dependencyResult.data || [])
        setSuggestions(suggestionResult.data || [])
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
          setSuggestionLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [open, task, liveMode])

  const eligibleMembers = useMemo(
    () => projectMembers.filter((member) => member.projectRole !== 'VIEWER'),
    [projectMembers],
  )

  const availableDependencyTasks = useMemo(() => {
    const currentId = String(task?.apiId || '')
    const related = new Set()
    dependencies.forEach((item) => {
      related.add(String(item.predecessorTaskId?._id))
      related.add(String(item.successorTaskId?._id))
    })
    return projectTasks.filter((candidate) => {
      if (String(candidate.apiId) === currentId) return false
      const candidateId = String(candidate.apiId)
      const alreadyLinked = dependencies.some((item) =>
        (String(item.predecessorTaskId?._id) === candidateId && String(item.successorTaskId?._id) === currentId)
        || (String(item.predecessorTaskId?._id) === currentId && String(item.successorTaskId?._id) === candidateId)
      )
      return !alreadyLinked
    })
  }, [projectTasks, dependencies, task?.apiId])

  if (!open || !task) return null

  const saveField = async (field, value) => {
    if (!liveMode || !task.apiId || !canEditTask) return

    setSavingField(field)
    setError('')
    try {
      await api.updateTask(task.apiId, { [field]: value, ...(Number.isInteger(task.version) ? { version: task.version } : {}) })
      onChanged?.()
    } catch (err) {
      setError(err.message)
      if (field === 'title') setTitle(task.title || '')
      if (field === 'status') setStatus(task.statusValue || 'TODO')
      if (field === 'priority') setPriority(task.priorityValue || 'MEDIUM')
      if (field === 'assigneeId') setAssigneeId(task.assigneeId || '')
      if (field === 'dueDate') setDueDate(task.dueDate ? String(task.dueDate).slice(0, 10) : '')
      if (field === 'estimateMinutes') setEstimateMinutes(task.estimateMinutes || '')
    } finally {
      setSavingField('')
    }
  }

  const deleteTask = async () => {
    if (!liveMode || !task?.apiId || !canEditTask) return
    if (!window.confirm(`Delete task “${task.title}”? This cannot be undone.`)) return
    setSavingField('delete')
    setError('')
    try {
      await api.deleteTask(task.apiId)
      onChanged?.()
      onClose?.()
    } catch (err) {
      setError(err.message || 'Task could not be deleted.')
    } finally {
      setSavingField('')
    }
  }

  const submitComment = async (event) => {
    event.preventDefault()
    const message = comment.trim()
    if (!message || !liveMode || !task.apiId || !canEditTask) return

    setCommentBusy(true)
    setError('')
    try {
      const result = await api.addComment(task.apiId, message)
      setComments((current) => [...current, result.data])
      setActivity((current) => [...current, {
        id: 'local-comment-' + Date.now(),
        type: 'comment',
        action: 'COMMENT_ADDED',
        message,
        user: { name: 'You' },
        createdAt: new Date().toISOString(),
      }])
      setComment('')
      onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setCommentBusy(false)
    }
  }

  const shareTaskUpdate = async (event) => {
    event.preventDefault()
    const message = chatUpdate.trim()
    if (!message || !liveMode || !task.apiId || !task.projectId || !canEditTask) return

    setChatUpdateBusy(true)
    setError('')
    try {
      await api.sendProjectChat(task.projectId, message, { taskId: task.apiId })
      setChatUpdate('')
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setChatUpdateBusy(false)
    }
  }

  const addDependency = async (event) => {
    event.preventDefault()
    if (!dependencyTaskId || !liveMode || !task.apiId || !canEditTask) return
    setDependencyBusy(true)
    setError('')
    try {
      const result = await api.addTaskDependency(task.apiId, dependencyTaskId)
      setDependencies((current) => [...current, result.data])
      setDependencyTaskId('')
      onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setDependencyBusy(false)
    }
  }

  const removeDependency = async (dependencyId) => {
    setDependencyBusy(true)
    setError('')
    try {
      await api.removeTaskDependency(task.apiId, dependencyId)
      setDependencies((current) => current.filter((item) => item._id !== dependencyId))
      onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setDependencyBusy(false)
    }
  }

  const blockingItems = dependencies.filter((item) => String(item.successorTaskId?._id) === String(task.apiId))
  const blockedTasks = blockingItems.filter((item) => item.predecessorTaskId?.status !== 'COMPLETED')

  const applySuggestion = async (suggestion) => {
    const nextId = String(suggestion.userId)
    setAssigneeId(nextId)
    await saveField('assigneeId', nextId)
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="task-modal task-details-modal task-details-advanced-modal" role="dialog" aria-modal="true" aria-labelledby="task-details-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">Task details</span>
            <h2 id="task-details-title">{title || task.title}</h2>
            <p>{task.project} · {task.id}</p>
          </div>
          <button className="icon-button modal-close" type="button" onClick={onClose} aria-label="Close details"><Icon name="close" size={18} /></button>
        </div>

        {blockedTasks.length ? (
          <div className="task-blocked-callout"><Icon name="alert" size={17} /><div><strong>This task is blocked</strong><span>Complete {blockedTasks[0].predecessorTaskId?.title || 'the blocking task'} before moving this work forward.</span></div></div>
        ) : null}

        {!canEditTask && liveMode ? (
          <div className="permission-notice"><Icon name="settings" size={15} /><div><strong>Read-only task access</strong><span>Your project role does not allow task changes. You can review comments, dependencies and activity.</span></div></div>
        ) : null}

        <div className="task-detail-meta">
          <div><span className="detail-label">Assignee</span><strong>{task.assigneeName || 'Unassigned'}</strong></div>
          <div><span className="detail-label">Priority</span><Badge color={task.priority === 'High' || task.priority === 'Critical' ? 'rose' : task.priority === 'Medium' ? 'amber' : 'blue'}>{task.priority}</Badge></div>
          <div><span className="detail-label">Due</span><strong>{task.due || 'Not set'}</strong></div>
          <div><span className="detail-label">Estimate</span><strong>{task.estimateMinutes ? task.estimateMinutes + ' min' : 'Not set'}</strong></div>
        </div>

        {liveMode ? (
          <div className="field-grid task-edit-grid">
            <label className="field field-full"><span>Task title</span><input value={title} maxLength={180} onChange={(event) => setTitle(event.target.value)} onBlur={() => { if (title.trim() && title.trim() !== task.title) saveField('title', title.trim()) }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (title.trim() && title.trim() !== task.title) saveField('title', title.trim()) } }} disabled={!canEditTask || savingField === 'title'} /></label>
            <label className="field">
              <span>Status</span>
              <select value={status} onChange={(event) => { setStatus(event.target.value); saveField('status', event.target.value) }} disabled={!canEditTask || savingField === 'status'}>{statusLabels.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
            </label>
            <label className="field">
              <span>Priority</span>
              <select value={priority} onChange={(event) => { setPriority(event.target.value); saveField('priority', event.target.value) }} disabled={!canEditTask || savingField === 'priority'}>{priorityOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
            </label>
            <label className="field">
              <span>Assignee</span>
              <select value={assigneeId} onChange={(event) => { setAssigneeId(event.target.value); saveField('assigneeId', event.target.value || null) }} disabled={!canEditTask || savingField === 'assigneeId'}>
                <option value="">Unassigned</option>
                {eligibleMembers.map((member) => <option value={member.id} key={member.id}>{member.name} · {roleLabel(member.projectRole)}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Due date</span>
              <input type="date" value={dueDate} onChange={(event) => { setDueDate(event.target.value); saveField('dueDate', event.target.value || null) }} disabled={!canEditTask || savingField === 'dueDate'} />
            </label>
            <label className="field">
              <span>Estimated effort</span>
              <div className="input-with-suffix"><input type="number" min="5" max="43200" step="5" value={estimateMinutes} onChange={(event) => { setEstimateMinutes(event.target.value); saveField('estimateMinutes', event.target.value ? Number(event.target.value) : null) }} disabled={!canEditTask || savingField === 'estimateMinutes'} placeholder="60" /><span>min</span></div>
            </label>
          </div>
        ) : null}

        {liveMode ? (
          <div className="smart-assignment-panel task-smart-panel">
            <div className="smart-panel-head"><div><strong>Smart Assignment 2.0</strong><span>Ranked recommendations with explainable factors</span></div><Badge color="violet">TOP 3</Badge></div>
            {suggestionLoading ? <div className="suggestion-skeleton-list">{[1, 2, 3].map((item) => <div className="suggestion-skeleton" key={item}><i /><span /><span /></div>)}</div> : suggestions.length ? (
              <div className="suggestion-list">
                {suggestions.map((item, index) => (
                  <button type="button" className={'suggestion-card ' + (String(item.userId) === String(assigneeId) ? 'suggestion-card-selected' : '')} key={item.userId} onClick={() => canEditTask && applySuggestion(item)} disabled={!canEditTask}>
                    <Avatar initials={memberInitials(item.user?.name)} color={index === 0 ? 'violet' : index === 1 ? 'blue' : 'green'} size="sm" />
                    <span className="suggestion-copy"><strong>{item.user?.name || 'Team member'} {index === 0 ? <em>Best match</em> : null}</strong><small>{item.reason}</small></span>
                    <span className="suggestion-score">{Math.round(item.assignmentScore * 100)}%</span>
                    <span className="suggestion-load">{item.activeTaskCount} active · {item.activeMinutes} min</span>
                  </button>
                ))}
              </div>
            ) : <div className="suggestion-fallback"><Icon name="users" size={15} /><span>No eligible project member is available for a recommendation. Use manual assignment when someone joins.</span></div>}
          </div>
        ) : null}

        {task.description ? <div className="task-description-block"><span className="detail-label">Description</span><p>{task.description}</p></div> : null}

        <div className="advanced-detail-grid">
          <section className="detail-subpanel">
            <div className="workspace-section-head"><div><span className="eyebrow">Dependencies</span><h3>Task flow</h3><p>Know what is blocking this work and what it will unblock.</p></div></div>
            {blockingItems.map((item) => (
              <div className="dependency-row" key={item._id}>
                <span className="dependency-row-icon"><Icon name="link" size={14} /></span>
                <div><strong>Blocked by</strong><p>{item.predecessorTaskId?.title || 'Task'} · {item.predecessorTaskId?.status?.replaceAll('_', ' ')}</p></div>
                {canEditTask ? <button className="icon-button" type="button" onClick={() => removeDependency(item._id)} aria-label="Remove dependency" disabled={dependencyBusy}><Icon name="close" size={14} /></button> : null}
              </div>
            ))}
            {dependencies.filter((item) => String(item.predecessorTaskId?._id) === String(task.apiId)).map((item) => (
              <div className="dependency-row" key={item._id}>
                <span className="dependency-row-icon"><Icon name="link" size={14} /></span>
                <div><strong>Blocks</strong><p>{item.successorTaskId?.title || 'Task'} · {item.successorTaskId?.status?.replaceAll('_', ' ')}</p></div>
                {canEditTask ? <button className="icon-button" type="button" onClick={() => removeDependency(item._id)} aria-label="Remove dependency" disabled={dependencyBusy}><Icon name="close" size={14} /></button> : null}
              </div>
            ))}
            {!dependencies.length ? <div className="detail-empty">No dependencies yet.</div> : null}
            {canEditTask ? (
              <form className="dependency-form" onSubmit={addDependency}>
                <select value={dependencyTaskId} onChange={(event) => setDependencyTaskId(event.target.value)} disabled={dependencyBusy}>
                  <option value="">Select a predecessor task...</option>
                  {availableDependencyTasks.map((candidate) => <option value={candidate.apiId} key={candidate.apiId}>{candidate.title}</option>)}
                </select>
                <button className="secondary-button" type="submit" disabled={!dependencyTaskId || dependencyBusy}><Icon name="link" size={14} /> Add blocker</button>
              </form>
            ) : null}
          </section>

          <section className="detail-subpanel">
            <div className="workspace-section-head"><div><span className="eyebrow">Activity</span><h3>Task history</h3><p>Status, ownership, dependency and comment events.</p></div></div>
            {loading && !activity.length ? <div className="detail-empty">Loading task history...</div> : activity.length ? (
              <div className="task-activity-timeline">
                {activity.slice(-12).map((item) => (
                  <div className="task-activity-item" key={item.id}>
                    <span className="activity-dot" />
                    <div><strong>{item.user?.name || 'Team member'}</strong><p>{item.type === 'comment' ? item.message : item.message}</p><small>{new Date(item.createdAt).toLocaleString('en-IN')}</small></div>
                  </div>
                ))}
              </div>
            ) : <div className="detail-empty">No task history yet.</div>}
          </section>
        </div>

        {liveMode && canEditTask ? (
          <>
            <div className="details-divider" />
            <section className="task-share-update">
              <div className="workspace-section-head">
                <div><span className="eyebrow">Collaboration</span><h3>Share a task update</h3><p>Post directly to project chat with this task attached as context.</p></div>
                <Icon name="send" size={18} />
              </div>
              <form onSubmit={shareTaskUpdate}>
                <textarea value={chatUpdate} onChange={(event) => setChatUpdate(event.target.value)} placeholder="e.g. API integration is ready for review…" maxLength={2000} rows={3} />
                <div className="task-share-actions"><small>Visible to project members in team chat.</small><button className="primary-button primary-button-dark" type="submit" disabled={chatUpdateBusy || !chatUpdate.trim()}><Icon name="send" size={14} /> {chatUpdateBusy ? 'Posting...' : 'Post update'}</button></div>
              </form>
            </section>
          </>
        ) : null}

        <div className="details-divider" />

        <div className="comments-section">
          <div className="section-header"><div><h2>Comments</h2><p>{liveMode ? 'Keep task context close to the work.' : 'Comments are available after API integration.'}</p></div></div>
          {loading && !comments.length ? <div className="comment-empty">Loading comments...</div> : comments.length ? (
            <div className="comment-list">
              {comments.map((item) => (
                <div className="comment-item" key={item._id}>
                  <Avatar initials={memberInitials(item.userId?.name)} color="violet" size="sm" />
                  <div><strong>{item.userId?.name || 'Team member'}</strong><p>{item.message}</p><small>{new Date(item.createdAt).toLocaleString('en-IN')}</small></div>
                </div>
              ))}
            </div>
          ) : <div className="comment-empty">No comments yet. Start the conversation.</div>}
          {liveMode ? (
            <form className="comment-form" onSubmit={submitComment}>
              <input value={comment} onChange={(event) => setComment(event.target.value)} placeholder={canEditTask ? 'Write a comment...' : 'Read-only access'} disabled={!canEditTask || commentBusy} />
              <button className="primary-button primary-button-dark" type="submit" disabled={!canEditTask || commentBusy}>{commentBusy ? 'Posting...' : 'Post'}</button>
            </form>
          ) : null}
        </div>

        {error ? <div className="login-error">{error}</div> : null}
      </section>
    </div>
  )
}
