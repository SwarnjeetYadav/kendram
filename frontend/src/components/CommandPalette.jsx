import { useEffect, useMemo, useRef, useState } from 'react'
import Badge from './Badge'
import Icon from './Icon'
import { api } from '../lib/api'

function taskFromSearch(item) {
  return {
    apiId: item._id,
    projectId: item.projectId,
    id: String(item._id).slice(-6).toUpperCase(),
    title: item.title,
    project: item.projectName || 'Project',
    assigneeId: item.assigneeId?._id || null,
    assigneeName: item.assigneeId?.name || 'Unassigned',
    assignee: item.assigneeId?.name || 'Unassigned',
    priorityValue: item.priority,
    priority: item.priority === 'CRITICAL' ? 'Critical' : item.priority === 'HIGH' ? 'High' : item.priority === 'LOW' ? 'Low' : 'Medium',
    statusValue: item.status,
    status: item.status?.replaceAll('_', ' ') || 'Todo',
    dueDate: item.dueDate || null,
    due: item.dueDate ? new Date(item.dueDate).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }) : 'Not set',
  }
}

export default function CommandPalette({ onNavigate, onSelectTask }) {
  const inputRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState({ projects: [], tasks: [], members: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const handler = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(true)
      }
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    if (query.trim().length < 2) {
      setResults({ projects: [], tasks: [], members: [] })
      setLoading(false)
      return undefined
    }

    let cancelled = false
    const timer = setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const result = await api.listSearch(query)
        if (!cancelled) setResults(result.data || { projects: [], tasks: [], members: [] })
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 180)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, query])

  const close = () => {
    setOpen(false)
    setQuery('')
    setError('')
  }

  const quickActions = useMemo(() => [
    ['Projects', 'Browse project work', 'Projects'],
    ['My Tasks', 'Open your execution queue', 'My Tasks'],
    ['Team', 'Manage members and access', 'Team'],
    ['Reports', 'Review project health', 'Reports'],
  ], [])

  if (!open) {
    return (
      <button className="search-box search-box-trigger" type="button" onClick={() => setOpen(true)} aria-label="Open search and command palette">
        <Icon name="search" size={17} /><span>Search tasks, projects, members...</span><kbd>⌘ K</kbd>
      </button>
    )
  }

  return (
    <>
      <button className="command-backdrop" type="button" onClick={close} aria-label="Close command palette" />
      <section className="command-palette" role="dialog" aria-modal="true" aria-labelledby="command-palette-title">
        <div className="command-input-row">
          <Icon name="search" size={18} />
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects, tasks, members or commands..." aria-label="Global search" />
          <kbd>Esc</kbd>
        </div>
        <div className="command-content">
          {query.trim().length < 2 ? (
            <div className="command-section">
              <div className="command-section-title" id="command-palette-title">Quick actions</div>
              {quickActions.map(([title, description, target]) => (
                <button className="command-result" type="button" key={target} onClick={() => { onNavigate?.(target); close() }}>
                  <span className="command-result-icon"><Icon name={target === 'Team' ? 'users' : target === 'Reports' ? 'chart' : target === 'My Tasks' ? 'check' : 'folder'} size={16} /></span>
                  <span><strong>{title}</strong><small>{description}</small></span>
                  <span className="command-shortcut">Open</span>
                </button>
              ))}
            </div>
          ) : loading ? (
            <div className="command-empty">Searching your accessible workspace...</div>
          ) : error ? (
            <div className="command-empty command-error"><Icon name="alert" size={16} /> {error}</div>
          ) : (
            <>
              {results.projects?.length ? (
                <div className="command-section">
                  <div className="command-section-title">Projects</div>
                  {results.projects.map((item) => (
                    <button className="command-result" type="button" key={item._id} onClick={() => { onNavigate?.('Projects'); close() }}>
                      <span className="command-result-icon"><Icon name="folder" size={16} /></span>
                      <span><strong>{item.name}</strong><small>{item.status?.replaceAll('_', ' ') || 'Project'}{item.dueDate ? ' · Due ' + new Date(item.dueDate).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }) : ''}</small></span>
                      <Badge color="violet">Project</Badge>
                    </button>
                  ))}
                </div>
              ) : null}
              {results.tasks?.length ? (
                <div className="command-section">
                  <div className="command-section-title">Tasks</div>
                  {results.tasks.map((item) => (
                    <button className="command-result" type="button" key={item._id} onClick={() => { onSelectTask?.(taskFromSearch(item)); close() }}>
                      <span className="command-result-icon"><Icon name="check" size={16} /></span>
                      <span><strong>{item.title}</strong><small>{item.projectName || 'Project'} · {item.status?.replaceAll('_', ' ')}</small></span>
                      <Badge color={item.priority === 'HIGH' || item.priority === 'CRITICAL' ? 'rose' : 'amber'}>{item.priority}</Badge>
                    </button>
                  ))}
                </div>
              ) : null}
              {results.members?.length ? (
                <div className="command-section">
                  <div className="command-section-title">Members</div>
                  {results.members.map((item) => (
                    <button className="command-result" type="button" key={item._id} onClick={() => { onNavigate?.('Team'); close() }}>
                      <span className="command-result-icon"><Icon name="users" size={16} /></span>
                      <span><strong>{item.name}</strong><small>{item.email} · {item.role?.replaceAll('_', ' ')}</small></span>
                      <Badge color="blue">Member</Badge>
                    </button>
                  ))}
                </div>
              ) : null}
              {!results.projects?.length && !results.tasks?.length && !results.members?.length ? <div className="command-empty">No accessible results for “{query}”.</div> : null}
            </>
          )}
        </div>
      </section>
    </>
  )
}
