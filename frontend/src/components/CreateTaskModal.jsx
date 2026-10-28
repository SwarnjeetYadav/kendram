import { useEffect, useState } from 'react'
import Icon from './Icon'
import Avatar from './Avatar'
import Badge from './Badge'
import { taskMembers as demoMembers } from '../data/teamflowMock'
import { api } from '../lib/api'

const priorityValues = { Low: 'LOW', Medium: 'MEDIUM', High: 'HIGH', Critical: 'CRITICAL' }

function initialsFor(name = 'AN') {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

export default function CreateTaskModal({
  open,
  onClose,
  onCreate,
  projects = [],
  membersByProject = {},
  demoProject = null,
  liveMode = false,
  initialDueDate = '',
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('Medium')
  const [dueDate, setDueDate] = useState(initialDueDate || '')
  const [estimateMinutes, setEstimateMinutes] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [suggestionLoading, setSuggestionLoading] = useState(false)
  const [suggestionError, setSuggestionError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setSelectedProjectId((current) => current || projects[0]?._id || '')
    setDueDate(initialDueDate || '')
  }, [open, projects, initialDueDate])

  useEffect(() => {
    setAssigneeId('')
    setSuggestions([])
    setSuggestionError('')
    setError('')
  }, [selectedProjectId, priority, dueDate, estimateMinutes])

  useEffect(() => {
    if (!open || !liveMode || !selectedProjectId) return undefined

    let cancelled = false
    const timer = setTimeout(async () => {
      setSuggestionLoading(true)
      setSuggestionError('')
      try {
        const result = await api.getAssignmentSuggestionsForProject(selectedProjectId, {
          priority: priorityValues[priority],
          dueDate: dueDate || null,
          estimateMinutes: estimateMinutes || null,
        })
        if (!cancelled) setSuggestions(result.data || [])
      } catch (err) {
        if (!cancelled) setSuggestionError(err.message)
      } finally {
        if (!cancelled) setSuggestionLoading(false)
      }
    }, 220)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, liveMode, selectedProjectId, priority, dueDate, estimateMinutes])

  const selectedProject = projects.find((item) => item._id === selectedProjectId) || demoProject
  const options = liveMode
    ? (membersByProject[selectedProjectId] || [])
    : demoMembers

  const suggested = liveMode ? suggestions[0] : (
    [...options].sort((a, b) => (a.activeTasks || 0) - (b.activeTasks || 0))[0]
  )

  if (!open) return null

  const submit = async (event) => {
    event.preventDefault()
    const cleanTitle = title.trim()

    if (!cleanTitle) {
      setError('Task title is required')
      return
    }

    if (liveMode && !selectedProjectId) {
      setError('Select a project before adding tasks')
      return
    }

    setBusy(true)
    setError('')

    try {
      if (liveMode) {
        await onCreate({
          projectId: selectedProjectId,
          payload: {
            title: cleanTitle,
            description: description.trim(),
            priority: priorityValues[priority],
            dueDate: dueDate || null,
            estimateMinutes: estimateMinutes ? Number(estimateMinutes) : null,
            ...(assigneeId ? { assigneeId } : {}),
          },
        })
      } else {
        const chosen = options.find((item) => item.id === assigneeId) || suggested
        await onCreate({
          id: 'AN-' + Math.floor(130 + Math.random() * 60),
          title: cleanTitle,
          project: selectedProject?.name || 'Kendram Web',
          assignee: chosen?.initials || 'SY',
          assigneeName: chosen?.name || 'Swarnjeet Yadav',
          priority,
          status: 'Todo',
          due: dueDate || 'Not set',
        })
      }

      setTitle('')
      setDescription('')
      setPriority('Medium')
      setDueDate('')
      setEstimateMinutes('')
      setAssigneeId('')
      setSuggestions([])
      setError('')
      setBusy(false)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const selectSuggestion = (item) => setAssigneeId(String(item.userId))

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="task-modal task-create-advanced-modal" role="dialog" aria-modal="true" aria-labelledby="create-task-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div><span className="eyebrow">Quick create</span><h2 id="create-task-title">Create a task</h2><p>{selectedProject?.name || 'Select a project'}</p></div>
          <button className="icon-button modal-close" type="button" onClick={onClose} aria-label="Close modal"><Icon name="close" size={18} /></button>
        </div>

        <form onSubmit={submit}>
          {liveMode ? (
            <label className="field">
              <span>Project</span>
              <select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)} disabled={busy}>
                <option value="">Select project</option>
                {projects.map((project) => <option value={project._id} key={project._id}>{project.name}</option>)}
              </select>
            </label>
          ) : null}

          <label className="field"><span>Task title</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Finalize sprint review report" minLength={2} maxLength={180} required /></label>
          <label className="field"><span>Description <small className="field-optional">Optional</small></span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Add context, expected outcome, or acceptance notes..." maxLength={4000} rows={3} /></label>

          <div className="field-grid">
            <label className="field"><span>Priority</span><select value={priority} onChange={(event) => setPriority(event.target.value)}><option>Low</option><option>Medium</option><option>High</option><option>Critical</option></select></label>
            <label className="field"><span>Due date</span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
            <label className="field"><span>Estimated effort</span><div className="input-with-suffix"><input type="number" min="5" max="43200" step="5" value={estimateMinutes} onChange={(event) => setEstimateMinutes(event.target.value)} placeholder="60" /><span>min</span></div></label>
          </div>

          <div className="field">
            <div className="field-with-helper"><span>Assignee</span><small>Choose a teammate manually or let Kendram recommend one.</small></div>
            {liveMode ? (
              <div className="smart-assignment-panel">
                <div className="smart-panel-head"><div><strong>Smart Assignment 2.0</strong><span>Explainable workload-aware recommendations</span></div><Badge color="violet">TOP 3</Badge></div>
                {suggestionLoading ? (
                  <div className="suggestion-skeleton-list">{[1, 2, 3].map((item) => <div className="suggestion-skeleton" key={item}><i /><span /><span /></div>)}</div>
                ) : suggestionError ? (
                  <div className="suggestion-fallback"><Icon name="alert" size={15} /><span>Recommendations are unavailable right now. Manual assignment remains available.</span></div>
                ) : suggestions.length ? (
                  <div className="suggestion-list">
                    {suggestions.map((item, index) => (
                      <button type="button" key={item.userId} className={'suggestion-card ' + (assigneeId === String(item.userId) ? 'suggestion-card-selected' : '')} onClick={() => selectSuggestion(item)}>
                        <Avatar initials={initialsFor(item.user?.name)} color={index === 0 ? 'violet' : index === 1 ? 'blue' : 'green'} size="sm" />
                        <span className="suggestion-copy">
                          <strong>{item.user?.name || 'Team member'} {index === 0 ? <em>Best match</em> : null}</strong>
                          <small>{item.reason}</small>
                        </span>
                        <span className="suggestion-score">{Math.round(item.assignmentScore * 100)}%</span>
                        <span className="suggestion-load">{item.activeTaskCount} active · {item.activeMinutes} min</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="suggestion-fallback"><Icon name="users" size={15} /><span>No eligible teammates are available yet. Create the task unassigned or add a teammate.</span></div>
                )}
              </div>
            ) : null}

            <div className="manual-assignee-list">
              {options.map((member) => (
                <button type="button" key={member.id} className={'assignee-option ' + (assigneeId === member.id ? 'assignee-option-selected' : '')} onClick={() => setAssigneeId(member.id)}>
                  <Avatar initials={member.initials} color={member.tone || 'violet'} size="sm" />
                  <div><strong>{member.name}</strong><small>{member.activeTasks || 0} active tasks</small></div>
                  <span className="assignee-load">{member.activeTasks || 0}</span>
                </button>
              ))}
            </div>
          </div>

          {error ? <div className="login-error">{error}</div> : null}
          <div className="modal-actions"><button type="button" className="ghost-dark-button" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="primary-button primary-button-dark" disabled={busy}><Icon name="plus" size={15} /> {busy ? 'Creating...' : 'Create task'}</button></div>
        </form>
      </section>
    </div>
  )
}
