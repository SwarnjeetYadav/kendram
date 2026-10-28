import { useEffect, useMemo, useState } from 'react'
import Badge from './Badge'
import Icon from './Icon'
import TaskTable from './TaskTable'
import { api } from '../lib/api'

const VIEWS = [
  ['overview', 'Overview'],
  ['board', 'Board'],
  ['list', 'List'],
  ['calendar', 'Calendar'],
  ['timeline', 'Timeline'],
  ['activity', 'Activity'],
]

const STATUS_COLUMNS = [
  ['TODO', 'Todo'],
  ['IN_PROGRESS', 'In progress'],
  ['REVIEW', 'Review'],
  ['BLOCKED', 'Blocked'],
  ['COMPLETED', 'Completed'],
]

const PRIORITY_COLOR = {
  Critical: 'rose',
  High: 'rose',
  Medium: 'amber',
  Low: 'blue',
}

function toStatusValue(task = {}) {
  return task.statusValue || task.status?.toString().toUpperCase().replaceAll(' ', '_') || 'TODO'
}

function toStatusLabel(task = {}) {
  const value = toStatusValue(task)
  return value === 'IN_PROGRESS' ? 'In progress' : value.charAt(0) + value.slice(1).toLowerCase()
}

function toPriority(task = {}) {
  const raw = task.priority || task.priorityValue || 'Medium'
  return raw === 'CRITICAL' ? 'Critical' : raw === 'HIGH' ? 'High' : raw === 'LOW' ? 'Low' : 'Medium'
}

function dueState(task = {}) {
  const value = task.dueDate
  if (!value || toStatusValue(task) === 'COMPLETED') return 'neutral'
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return 'neutral'
  const diff = timestamp - Date.now()
  if (diff < 0) return 'danger'
  if (diff <= 48 * 36e5) return 'warning'
  return 'neutral'
}

function dueLabel(task = {}) {
  if (!task.dueDate) return 'No due date'
  const date = new Date(task.dueDate)
  if (Number.isNaN(date.getTime())) return 'No due date'
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function dateKey(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

function startOfWeek(value) {
  const date = new Date(value)
  const day = date.getDay()
  const offset = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + offset)
  date.setHours(0, 0, 0, 0)
  return date
}

function monthLabel(value) {
  return value.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

function taskKey(task, index) {
  return String(task.apiId || task._id || task.id || task.title || 'task-' + index)
}

function BoardCard({ task, onOpen, onDragStart }) {
  const priority = toPriority(task)
  const due = dueState(task)
  return (
    <article
      className="kanban-card"
      draggable
      tabIndex={0}
      onDragStart={(event) => onDragStart?.(event, task)}
      onClick={() => onOpen?.(task)}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && onOpen) {
          event.preventDefault()
          onOpen(task)
        }
      }}
    >
      <div className="kanban-card-top">
        <Badge color={PRIORITY_COLOR[priority] || 'neutral'}>{priority}</Badge>
        {(task.dependencyCount || 0) > 0 ? <span className="dependency-chip"><Icon name="link" size={12} /> {task.dependencyCount}</span> : null}
      </div>
      <h4>{task.title || 'Untitled task'}</h4>
      <div className="kanban-card-meta">
        <span className={due === 'danger' ? 'due-risk-danger' : due === 'warning' ? 'due-risk-warning' : ''}><Icon name="calendar" size={13} /> {dueLabel(task)}</span>
        <span><Icon name="users" size={13} /> {task.assigneeName || 'Unassigned'}</span>
      </div>
      {task.hasBlockingDependencies || toStatusValue(task) === 'BLOCKED' ? (
        <div className="blocker-banner"><Icon name="alert" size={13} /> {task.hasBlockingDependencies ? 'Blocked by predecessor work' : 'Marked as blocked'}</div>
      ) : null}
    </article>
  )
}

export default function ProjectWorkspace({
  project,
  tasks = [],
  members = [],
  currentUserId,
  onSelectTask,
  onCreateTask,
  onCreateTaskForDate,
  onRefresh,
  onOpenTeam,
}) {
  const safeProject = project || {}
  const safeTasks = Array.isArray(tasks) ? tasks.filter(Boolean) : []
  const safeMembers = Array.isArray(members) ? members.filter(Boolean) : []
  const viewKey = 'anvaya_project_view_' + String(currentUserId || 'user') + '_' + String(safeProject._id || 'project')

  const [view, setView] = useState('overview')
  const [filter, setFilter] = useState('')
  const [movingTaskId, setMovingTaskId] = useState('')
  const [optimisticStatuses, setOptimisticStatuses] = useState({})
  const [calendarCursor, setCalendarCursor] = useState(new Date())
  const [calendarMode, setCalendarMode] = useState('month')
  const [analytics, setAnalytics] = useState(null)
  const [insights, setInsights] = useState([])
  const [activity, setActivity] = useState([])
  const [metaLoading, setMetaLoading] = useState(false)
  const [metaError, setMetaError] = useState('')
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false)
  const [projectSettings, setProjectSettings] = useState({ name: safeProject.name || '', description: safeProject.description || '', status: safeProject.status || 'ACTIVE', startDate: safeProject.startDate ? String(safeProject.startDate).slice(0, 10) : '', dueDate: safeProject.dueDate ? String(safeProject.dueDate).slice(0, 10) : '' })
  const [settingsBusy, setSettingsBusy] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(viewKey)
      if (VIEWS.some(([value]) => value === saved)) setView(saved)
    } catch {
      // Keep the default overview when storage is unavailable.
    }
  }, [viewKey])

  useEffect(() => {
    try { localStorage.setItem(viewKey, view) } catch {
      // Storage is optional.
    }
  }, [view, viewKey])

  useEffect(() => {
    if (!safeProject._id) return undefined
    let cancelled = false
    setMetaLoading(true)
    setMetaError('')

    Promise.allSettled([
      api.listProjectAnalytics(safeProject._id),
      api.listProjectInsights(safeProject._id),
      api.listProjectActivity(safeProject._id),
    ])
      .then((results) => {
        if (cancelled) return
        const [analyticsResult, insightResult, activityResult] = results
        if (analyticsResult.status === 'fulfilled') setAnalytics(analyticsResult.value?.data || null)
        if (insightResult.status === 'fulfilled') setInsights(Array.isArray(insightResult.value?.data) ? insightResult.value.data : [])
        if (activityResult.status === 'fulfilled') setActivity(Array.isArray(activityResult.value?.data) ? activityResult.value.data : [])
        const failed = results.find((item) => item.status === 'rejected')
        if (failed) setMetaError('Some project intelligence could not be refreshed. Your task data is still available.')
      })
      .finally(() => {
        if (!cancelled) setMetaLoading(false)
      })

    return () => { cancelled = true }
  }, [safeProject._id, safeTasks.length])

  const normalizedTasks = useMemo(() => safeTasks.map((task) => {
    const key = String(task.apiId || task._id || task.id || '')
    const statusValue = optimisticStatuses[key] || toStatusValue(task)
    return {
      ...task,
      title: task.title?.toString() || 'Untitled task',
      statusValue,
      status: statusValue === 'IN_PROGRESS' ? 'In progress' : statusValue.charAt(0) + statusValue.slice(1).toLowerCase(),
      priority: toPriority(task),
      assigneeName: task.assigneeName?.toString() || 'Unassigned',
    }
  }), [safeTasks, optimisticStatuses])

  useEffect(() => {
    setOptimisticStatuses((current) => {
      const next = { ...current }
      for (const task of safeTasks) {
        const key = String(task.apiId || task._id || task.id || '')
        if (key && next[key] && toStatusValue(task) === next[key]) delete next[key]
      }
      return next
    })
  }, [safeTasks])

  const visibleTasks = useMemo(() => {
    const query = filter.trim().toLowerCase()
    if (!query) return normalizedTasks
    return normalizedTasks.filter((task) =>
      task.title.toLowerCase().includes(query)
      || task.assigneeName.toLowerCase().includes(query)
      || task.status.toLowerCase().includes(query)
      || task.priority.toLowerCase().includes(query)
    )
  }, [normalizedTasks, filter])

  const board = useMemo(() => {
    const grouped = Object.fromEntries(STATUS_COLUMNS.map(([value]) => [value, []]))
    visibleTasks.forEach((task) => {
      const key = grouped[task.statusValue] ? task.statusValue : 'TODO'
      grouped[key].push(task)
    })
    return grouped
  }, [visibleTasks])

  const groupedDates = useMemo(() => {
    const grouped = new Map()
    visibleTasks.forEach((task) => {
      if (!task.dueDate) return
      const key = dateKey(task.dueDate)
      if (!key) return
      grouped.set(key, [...(grouped.get(key) || []), task])
    })
    return grouped
  }, [visibleTasks])

  const calendarDates = useMemo(() => {
    if (calendarMode === 'week') {
      const start = startOfWeek(calendarCursor)
      return Array.from({ length: 7 }, (_, index) => {
        const value = new Date(start)
        value.setDate(start.getDate() + index)
        return value
      })
    }

    const first = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1)
    const last = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 0)
    const offset = first.getDay() === 0 ? 6 : first.getDay() - 1
    const values = []
    for (let index = 0; index < offset; index += 1) {
      const value = new Date(first)
      value.setDate(first.getDate() - offset + index)
      values.push(value)
    }
    for (let day = 1; day <= last.getDate(); day += 1) {
      values.push(new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), day))
    }
    while (values.length < 42) {
      const value = new Date(values[values.length - 1])
      value.setDate(value.getDate() + 1)
      values.push(value)
    }
    return values
  }, [calendarCursor, calendarMode])

  const timelineTasks = useMemo(() => {
    const dated = visibleTasks
      .filter((task) => task.dueDate)
      .map((task) => {
        const start = new Date(task.createdAt || task.dueDate).getTime()
        const end = new Date(task.dueDate).getTime()
        return {
          task,
          start: Number.isFinite(start) ? start : end - 864e5,
          end: Number.isFinite(end) ? end : Date.now(),
        }
      })
      .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end))

    if (!dated.length) return []
    const min = Math.min(...dated.map((item) => item.start))
    const max = Math.max(...dated.map((item) => Math.max(item.end, item.start + 864e5)))

    return dated.map((item) => {
      const range = Math.max(max - min, 1)
      return {
        ...item,
        left: Math.max(0, Math.min(96, ((item.start - min) / range) * 100)),
        width: Math.max(4, Math.min(100, ((Math.max(item.end, item.start + 864e5) - item.start) / range) * 100)),
      }
    })
  }, [visibleTasks])

  const completed = visibleTasks.filter((task) => task.statusValue === 'COMPLETED').length
  const blocked = visibleTasks.filter((task) => task.hasBlockingDependencies || task.statusValue === 'BLOCKED').length
  const urgent = visibleTasks.filter((task) => ['warning', 'danger'].includes(dueState(task))).length
  const unassigned = visibleTasks.filter((task) => !task.assigneeId).length
  const completion = visibleTasks.length ? Math.round((completed / visibleTasks.length) * 100) : 0
  const statusText = (safeProject.status || 'ACTIVE').toString().replaceAll('_', ' ')

  const openProjectSettings = () => {
    setProjectSettings({ name: safeProject.name || '', description: safeProject.description || '', status: safeProject.status || 'ACTIVE', startDate: safeProject.startDate ? String(safeProject.startDate).slice(0, 10) : '', dueDate: safeProject.dueDate ? String(safeProject.dueDate).slice(0, 10) : '' })
    setMetaError('')
    setProjectSettingsOpen(true)
  }

  const saveProjectSettings = async (event) => {
    event.preventDefault()
    setSettingsBusy(true)
    setMetaError('')
    try {
      await api.updateProject(safeProject._id, { ...projectSettings, startDate: projectSettings.startDate || null, dueDate: projectSettings.dueDate || null })
      setProjectSettingsOpen(false)
      onRefresh?.()
    } catch (error) {
      setMetaError(error.message || 'Project settings could not be saved.')
    } finally {
      setSettingsBusy(false)
    }
  }

  const deleteProject = async () => {
    if (!window.confirm(`Delete project “${safeProject.name}” and its project data? This cannot be undone.`)) return
    setSettingsBusy(true)
    setMetaError('')
    try {
      await api.deleteProject(safeProject._id)
      setProjectSettingsOpen(false)
      onRefresh?.()
    } catch (error) {
      setMetaError(error.message || 'Project could not be deleted.')
    } finally {
      setSettingsBusy(false)
    }
  }

  const moveTask = async (taskId, status) => {
    if (!taskId || !status || movingTaskId) return
    const task = normalizedTasks.find((item) => String(item.apiId || item._id || item.id) === String(taskId))
    if (!task || task.statusValue === status) return
    const previousStatus = task.statusValue
    setMovingTaskId(taskId)
    setMetaError('')
    setOptimisticStatuses((current) => ({ ...current, [String(taskId)]: status }))
    try {
      await api.updateTask(taskId, { status, version: Number.isInteger(task.version) ? task.version : 1 })
      onRefresh?.()
    } catch (error) {
      setOptimisticStatuses((current) => {
        const next = { ...current }
        delete next[String(taskId)]
        return next
      })
      setMetaError(error?.status === 409
        ? 'This task changed elsewhere. The board has been reverted; refresh and try again.'
        : error?.message || 'The task could not be moved.')
      onRefresh?.()
    } finally {
      setMovingTaskId('')
    }
  }

  if (!safeProject._id) return null

  return (
    <section className="project-workspace">
      <header className="project-workspace-hero">
        <div className="project-workspace-identity">
          <div className="project-workspace-mark">{safeProject.name?.toString().slice(0, 1).toUpperCase() || 'P'}</div>
          <div>
            <div className="project-workspace-kicker"><span>Project workspace</span><i /> <span>{statusText}</span></div>
            <div className="project-workspace-title-row">
              <h2>{safeProject.name?.toString() || 'Project'}</h2>
              <Badge color={statusText === 'COMPLETED' ? 'green' : statusText === 'ON HOLD' ? 'amber' : 'violet'}>{statusText}</Badge>
            </div>
            <p>{safeProject.description?.toString() || 'A focused workspace for delivery, ownership, deadlines, dependencies and team collaboration.'}</p>
          </div>
        </div>
        <div className="project-workspace-actions">
          <button className="secondary-button" type="button" onClick={openProjectSettings}><Icon name="settings" size={15} /> Project settings</button>
          <button className="secondary-button" type="button" onClick={onOpenTeam}><Icon name="users" size={15} /> Manage team</button>
          <button className="primary-button primary-button-dark" type="button" onClick={onCreateTask}><Icon name="plus" size={15} /> New task</button>
        </div>
      </header>

      <div className="project-workspace-summary">
        <div className="workspace-summary-main">
          <span>Delivery progress</span>
          <strong>{completion}%</strong>
          <div className="summary-progress"><i style={{ width: completion + '%' }} /></div>
          <small>{completed} of {visibleTasks.length} tracked tasks completed</small>
        </div>
        <div className="workspace-summary-item"><span>At risk</span><strong>{urgent}</strong><small>due soon or overdue</small></div>
        <div className="workspace-summary-item"><span>Blocked</span><strong>{blocked}</strong><small>dependency or status</small></div>
        <div className="workspace-summary-item"><span>Unassigned</span><strong>{unassigned}</strong><small>needs ownership</small></div>
        <div className="workspace-summary-item"><span>Team</span><strong>{safeMembers.length}</strong><small>project members</small></div>
      </div>

      <div className="project-view-bar">
        <nav className="project-view-tabs" role="tablist" aria-label="Project views">
          {VIEWS.map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={view === value} className={view === value ? 'project-view-tab project-view-tab-active' : 'project-view-tab'} onClick={() => setView(value)}>{label}</button>
          ))}
        </nav>
        <label className="project-view-filter">
          <Icon name="search" size={15} />
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter project work…" aria-label="Filter project work" />
        </label>
      </div>

      {metaLoading ? <div className="workspace-inline-status"><span className="status-spinner" />Refreshing project intelligence…</div> : null}
      {metaError ? <div className="workspace-error-banner">{metaError}</div> : null}

      {view === 'overview' ? (
        <div className="project-overview-layout">
          <div className="project-overview-main">
            <section className="workspace-card workspace-card-priority">
              <div className="workspace-card-head">
                <div><span className="section-kicker">Attention</span><h3>Focus on what needs action</h3><p>Prioritize blockers and near-term commitments before routine work.</p></div>
                <span className="workspace-card-count">{urgent + blocked}</span>
              </div>
              <div className="attention-list">
                {visibleTasks.filter((task) => dueState(task) !== 'neutral' || task.hasBlockingDependencies || task.statusValue === 'BLOCKED').slice(0, 7).map((task, index) => (
                  <button className="attention-row" type="button" key={taskKey(task, index)} onClick={() => onSelectTask?.(task)}>
                    <span className={task.hasBlockingDependencies || task.statusValue === 'BLOCKED' ? 'attention-icon attention-icon-danger' : 'attention-icon'}><Icon name={task.hasBlockingDependencies || task.statusValue === 'BLOCKED' ? 'alert' : 'calendar'} size={15} /></span>
                    <span><strong>{task.title}</strong><small>{task.hasBlockingDependencies ? 'Blocked by dependency · ' : ''}{dueLabel(task)} · {task.assigneeName}</small></span>
                    <Icon name="chevron" size={16} />
                  </button>
                ))}
                {!visibleTasks.some((task) => dueState(task) !== 'neutral' || task.hasBlockingDependencies || task.statusValue === 'BLOCKED') ? <div className="empty-state">No urgent work. The project is currently moving cleanly.</div> : null}
              </div>
            </section>

            <section className="workspace-card">
              <div className="workspace-card-head"><div><span className="section-kicker">Work mix</span><h3>Execution by status</h3><p>Use the distribution to understand where work is accumulating.</p></div></div>
              <div className="status-overview-grid">
                {STATUS_COLUMNS.map(([value, label]) => (
                  <button type="button" className="status-overview-card" key={value} onClick={() => setView('board')}>
                    <span>{label}</span><strong>{board[value]?.length || 0}</strong><i><em style={{ width: (visibleTasks.length ? ((board[value]?.length || 0) / visibleTasks.length) * 100 : 0) + '%' }} /></i>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <aside className="project-overview-side">
            <section className="workspace-card insight-panel">
              <div className="workspace-card-head"><div><span className="section-kicker">Kendram Insights</span><h3>Project health</h3><p>Rules-based delivery signals.</p></div><Badge color={insights[0]?.severity === 'HIGH' ? 'rose' : insights[0]?.severity === 'MEDIUM' ? 'amber' : 'green'}>{insights[0]?.signal || 'Healthy'}</Badge></div>
              <div className="insight-stack">
                {insights.slice(0, 4).map((insight, index) => (
                  <button className="insight-card" type="button" key={insight.type || 'insight-' + index} onClick={() => {
                    const id = insight.entityIds?.[0]
                    const task = visibleTasks.find((item) => String(item.apiId) === String(id))
                    if (task) onSelectTask?.(task)
                  }}>
                    <div className="insight-card-head"><Badge color={insight.severity === 'HIGH' ? 'rose' : insight.severity === 'MEDIUM' ? 'amber' : 'green'}>{insight.signal || 'Signal'}</Badge><Icon name="chevron" size={14} /></div>
                    <strong>{insight.reason || 'No additional explanation available.'}</strong>
                    <span>{insight.action || 'Review the affected work.'}</span>
                  </button>
                ))}
                {!insights.length ? <div className="empty-state">No active risk signals. Keep the current delivery rhythm.</div> : null}
              </div>
            </section>

            <section className="workspace-card">
              <div className="workspace-card-head"><div><span className="section-kicker">Delivery</span><h3>Performance snapshot</h3></div></div>
              <div className="performance-metrics">
                <div><strong>{analytics?.medianCycleTimeHours || 0}<small>h</small></strong><span>median cycle time</span></div>
                <div><strong>{analytics?.throughput?.reduce((sum, item) => sum + Number(item.completed || 0), 0) || 0}</strong><span>recent completions</span></div>
              </div>
              <div className="workload-mini-list">
                {(analytics?.workload || []).slice(0, 6).map((item, index) => {
                  const member = safeMembers.find((candidate) => String(candidate.id) === String(item.userId))
                  const load = Number(item.activeTasks || 0)
                  return <div key={String(item.userId || index)}><span>{member?.name || 'Team member'}</span><div><i style={{ width: Math.min(100, load * 14) + '%' }} /></div><strong>{load}</strong></div>
                })}
              </div>
            </section>
          </aside>
        </div>
      ) : null}

      {view === 'board' ? (
        <div className="kanban-board" aria-label="Project task board">
          {STATUS_COLUMNS.map(([value, label]) => (
            <section
              className="kanban-column"
              key={value}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                moveTask(event.dataTransfer.getData('text/task-id'), value)
              }}
            >
              <header><div><strong>{label}</strong><span>{board[value]?.length || 0}</span></div>{value === 'IN_PROGRESS' && (board[value]?.length || 0) >= 6 ? <Badge color="amber">High load</Badge> : null}</header>
              <div className="kanban-card-list">
                {(board[value] || []).map((task, index) => (
                  <BoardCard key={taskKey(task, index)} task={task} onOpen={onSelectTask} onDragStart={(event, item) => event.dataTransfer.setData('text/task-id', item.apiId || item._id || item.id || '')} />
                ))}
                {!(board[value] || []).length ? <div className="kanban-empty">Drop a task here</div> : null}
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {view === 'list' ? (
        <section className="workspace-card">
          <div className="workspace-card-head"><div><span className="section-kicker">List</span><h3>Project work queue</h3><p>Precise table view for reviewing the full task set.</p></div><span className="workspace-card-count">{visibleTasks.length}</span></div>
          <TaskTable tasks={visibleTasks} onSelectTask={onSelectTask} />
        </section>
      ) : null}

      {view === 'calendar' ? (
        <section className="workspace-card calendar-panel">
          <div className="calendar-toolbar">
            <div><span className="section-kicker">Schedule</span><h3>{calendarMode === 'month' ? monthLabel(calendarCursor) : 'Week of ' + calendarCursor.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</h3><p>Plan deadlines and create work directly from the calendar.</p></div>
            <div className="calendar-toolbar-actions">
              <div className="segmented-control"><button type="button" className={calendarMode === 'month' ? 'active' : ''} onClick={() => setCalendarMode('month')}>Month</button><button type="button" className={calendarMode === 'week' ? 'active' : ''} onClick={() => setCalendarMode('week')}>Week</button></div>
              <button className="calendar-nav-button" type="button" onClick={() => setCalendarCursor(new Date())}>Today</button>
              <button className="calendar-nav-button" type="button" onClick={() => { const value = new Date(calendarCursor); if (calendarMode === 'week') value.setDate(value.getDate() - 7); else value.setMonth(value.getMonth() - 1); setCalendarCursor(value) }} aria-label="Previous period">‹</button>
              <button className="calendar-nav-button" type="button" onClick={() => { const value = new Date(calendarCursor); if (calendarMode === 'week') value.setDate(value.getDate() + 7); else value.setMonth(value.getMonth() + 1); setCalendarCursor(value) }} aria-label="Next period">›</button>
            </div>
          </div>
          <div className="project-calendar">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <div className="calendar-weekday" key={day}>{day}</div>)}
            {calendarDates.map((date) => {
              const key = dateKey(date)
              const dayTasks = groupedDates.get(key) || []
              const inMonth = date.getMonth() === calendarCursor.getMonth()
              return (
                <div className={'calendar-cell ' + (!inMonth ? 'calendar-cell-muted' : '')} key={key}>
                  <div className="calendar-cell-head"><span>{date.getDate()}</span><button type="button" onClick={() => onCreateTaskForDate?.(key)} aria-label={'Create task on ' + key}>＋</button></div>
                  <div className="calendar-task-list">
                    {dayTasks.slice(0, 3).map((task, index) => <button type="button" key={taskKey(task, index)} onClick={() => onSelectTask?.(task)} className="calendar-task-item"><span>{task.title}</span><Badge color={PRIORITY_COLOR[task.priority] || 'neutral'}>{task.priority}</Badge></button>)}
                    {dayTasks.length > 3 ? <span className="calendar-more">+{dayTasks.length - 3} more</span> : null}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      {view === 'timeline' ? (
        <section className="workspace-card timeline-panel">
          <div className="workspace-card-head"><div><span className="section-kicker">Timeline</span><h3>Delivery flow</h3><p>See dated work against its delivery horizon.</p></div></div>
          {timelineTasks.length ? (
            <div className="timeline-chart">
              {timelineTasks.map(({ task, left, width }, index) => (
                <button className="timeline-row" type="button" key={taskKey(task, index)} onClick={() => onSelectTask?.(task)}>
                  <span className="timeline-label"><strong>{task.title}</strong><small>{task.assigneeName} · {dueLabel(task)}</small></span>
                  <span className="timeline-track"><i style={{ left: left + '%', width: width + '%' }} /><em>{task.priority}</em></span>
                </button>
              ))}
            </div>
          ) : <div className="empty-state">Add due dates to see important work on the timeline.</div>}
        </section>
      ) : null}

      {view === 'activity' ? (
        <section className="workspace-card">
          <div className="workspace-card-head"><div><span className="section-kicker">History</span><h3>Project activity</h3><p>Changes across tasks, members and dependencies.</p></div><span className="workspace-card-count">{activity.length}</span></div>
          {activity.length ? (
            <div className="project-activity-timeline">
              {activity.map((item, index) => (
                <div className="project-activity-item" key={String(item._id || index)}>
                  <span className="activity-dot" />
                  <div><strong>{item.userId?.name || 'Team member'}</strong><p>{(item.action || 'updated project').toString().replaceAll('_', ' ').toLowerCase()}</p><small>{item.createdAt ? new Date(item.createdAt).toLocaleString('en-IN') : 'Recently'}</small></div>
                </div>
              ))}
            </div>
          ) : <div className="empty-state">No project activity has been recorded yet.</div>}
        </section>
      ) : null}
      {projectSettingsOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !settingsBusy && setProjectSettingsOpen(false)}>
          <section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="project-settings-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><span className="eyebrow">Project administration</span><h2 id="project-settings-title">Project settings</h2><p>Update the project details or remove this project.</p></div><button className="icon-button modal-close" type="button" onClick={() => setProjectSettingsOpen(false)} aria-label="Close settings"><Icon name="close" size={18} /></button></div>
            <form className="field-grid" onSubmit={saveProjectSettings}>
              <label className="field"><span>Project name</span><input required maxLength={120} value={projectSettings.name} onChange={(event) => setProjectSettings((current) => ({ ...current, name: event.target.value }))} /></label>
              <label className="field"><span>Status</span><select value={projectSettings.status} onChange={(event) => setProjectSettings((current) => ({ ...current, status: event.target.value }))}>{[['PLANNING','Planning'],['ACTIVE','Active'],['ON_HOLD','On hold'],['COMPLETED','Completed'],['ARCHIVED','Archived']].map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label className="field field-full"><span>Description</span><textarea rows={3} maxLength={1000} value={projectSettings.description} onChange={(event) => setProjectSettings((current) => ({ ...current, description: event.target.value }))} /></label>
              <label className="field"><span>Start date</span><input type="date" value={projectSettings.startDate} onChange={(event) => setProjectSettings((current) => ({ ...current, startDate: event.target.value }))} /></label>
              <label className="field"><span>Due date</span><input type="date" value={projectSettings.dueDate} onChange={(event) => setProjectSettings((current) => ({ ...current, dueDate: event.target.value }))} /></label>
              <div className="field-full project-settings-actions"><button className="primary-button primary-button-dark" type="submit" disabled={settingsBusy}>{settingsBusy ? 'Saving…' : 'Save settings'}</button><button className="danger-outline-button" type="button" onClick={deleteProject} disabled={settingsBusy}>Delete project</button></div>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  )
}
