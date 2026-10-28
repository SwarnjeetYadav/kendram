import { useEffect, useMemo, useState } from 'react'
import Badge from './Badge'
import Icon from './Icon'
import { api } from '../lib/api'

function normalizeAnalytics(data) {
  if (!data) return null
  // PostgreSQL analytics expose totals/byStatus/byPriority/tasksCreatedByMonth;
  // the report cards use the flattened dashboard shape.
  const totals = data.totals || {}
  const byStatus = data.byStatus || []
  const completed = Number(data.completedTasks ?? totals.completed ?? byStatus.find((item) => /done|completed/i.test(item.status || '') )?.count ?? 0)
  const total = Number(data.totalTasks ?? totals.total ?? byStatus.reduce((sum, item) => sum + Number(item.count || 0), 0))
  const overdue = Number(data.overdueTasks ?? totals.overdue ?? 0)
  const blocked = Number(data.blockedTasks ?? byStatus.find((item) => /blocked/i.test(item.status || ''))?.count ?? 0)
  const workload = Array.isArray(data.workload) ? data.workload : []
  const throughput = Array.isArray(data.throughput) ? data.throughput : (data.tasksCreatedByMonth || []).map((item) => ({ week: item.month, completed: 0, created: item.created }))
  return { ...data, totalTasks: total, completedTasks: completed, completionRate: Number(data.completionRate ?? totals.completionRate ?? (total ? Math.round(completed * 100 / total) : 0)), overdueTasks: overdue, overdueRate: Number(data.overdueRate ?? (total ? Math.round(overdue * 100 / total) : 0)), blockedTasks: blocked, dependencyCount: Number(data.dependencyCount ?? 0), workload, throughput, workloadSpread: Number(data.workloadSpread ?? 0), medianCycleTimeHours: Number(data.medianCycleTimeHours ?? 0) }
}

const insightTone = (severity) => severity === 'HIGH' ? 'rose' : severity === 'MEDIUM' ? 'amber' : 'green'

function percent(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : 0
}

export default function ReportsWorkspace({ projects = [], tasks = [], onSelectTask }) {
  const safeProjects = Array.isArray(projects) ? projects.filter(Boolean) : []
  const safeTasks = Array.isArray(tasks) ? tasks.filter(Boolean) : []
  const [projectId, setProjectId] = useState(safeProjects[0]?._id || '')
  const [analytics, setAnalytics] = useState(null)
  const [insights, setInsights] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!projectId && safeProjects[0]?._id) setProjectId(safeProjects[0]._id)
    if (projectId && !safeProjects.some((project) => project._id === projectId)) setProjectId(safeProjects[0]?._id || '')
  }, [safeProjects, projectId])

  useEffect(() => {
    if (!projectId) {
      setAnalytics(null)
      setInsights([])
      return undefined
    }

    let cancelled = false
    setLoading(true)
    setError('')

    Promise.allSettled([
      api.listProjectAnalytics(projectId),
      api.listProjectInsights(projectId),
    ]).then((results) => {
      if (cancelled) return
      const [analyticsResult, insightsResult] = results
      setAnalytics(analyticsResult.status === 'fulfilled' ? normalizeAnalytics(analyticsResult.value?.data) : null)
      setInsights(insightsResult.status === 'fulfilled' && Array.isArray(insightsResult.value?.data) ? insightsResult.value.data : [])
      if (results.some((result) => result.status === 'rejected')) {
        setError('Some analytics signals are temporarily unavailable. Core project data remains available.')
      }
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => { cancelled = true }
  }, [projectId])

  const selectedProject = safeProjects.find((project) => project._id === projectId)
  const projectTasks = safeTasks.filter((task) => String(task.projectId) === String(projectId))
  const projectTaskMap = useMemo(() => new Map(projectTasks.map((task) => [String(task.apiId || task._id), task])), [projectTasks])

  const throughput = Array.isArray(analytics?.throughput) ? analytics.throughput : []
  const hasThroughputActivity = throughput.some((item) => Number(item.completed || 0) > 0)
  const maxThroughput = Math.max(...throughput.map((item) => Number(item.completed || 0)), 1)
  const workload = Array.isArray(analytics?.workload) ? analytics.workload : []
  const maxWorkload = Math.max(...workload.map((item) => Number(item.activeTasks || 0)), 1)
  const riskCount = Number(analytics?.overdueTasks || 0) + Number(analytics?.blockedTasks || 0)

  return (
    <section className="reports-workspace">
      <header className="reports-hero">
        <div>
          <span className="eyebrow">Execution intelligence</span>
          <h2>Project performance</h2>
          <p>Understand delivery health, workload distribution and emerging risks without leaving the project context.</p>
        </div>
        <div className="reports-hero-actions">
          <label className="reports-project-select">
            <span>Project</span>
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label="Select analytics project">
              {safeProjects.map((project) => <option value={project._id} key={project._id}>{project.name}</option>)}
            </select>
          </label>
          {selectedProject?.status ? <Badge color="violet">{String(selectedProject.status).replaceAll('_', ' ')}</Badge> : null}
        </div>
      </header>

      {loading ? <div className="workspace-inline-status" role="status" aria-live="polite"><span className="status-spinner" aria-hidden="true" />Updating live project metrics…</div> : null}
      {error ? <div className="workspace-error-banner">{error}</div> : null}

      {selectedProject ? (
        <>
          <div className="reports-kpi-grid">
            <article className="reports-kpi reports-kpi-primary">
              <div className="reports-kpi-label"><span>Completion rate</span><Icon name="chart" size={15} /></div>
              <strong>{percent(analytics?.completionRate)}%</strong>
              <div className="reports-progress"><i style={{ width: percent(analytics?.completionRate) + '%' }} /></div>
              <small>{analytics?.completedTasks || 0} of {analytics?.totalTasks || 0} tracked tasks complete</small>
            </article>
            <article className="reports-kpi">
              <div className="reports-kpi-label"><span>Overdue</span><Icon name="calendar" size={15} /></div>
              <strong>{analytics?.overdueTasks || 0}</strong>
              <small>{analytics?.overdueRate || 0}% of tracked work is overdue</small>
            </article>
            <article className="reports-kpi">
              <div className="reports-kpi-label"><span>Blocked</span><Icon name="alert" size={15} /></div>
              <strong>{analytics?.blockedTasks || 0}</strong>
              <small>{analytics?.dependencyCount || 0} dependency relationships</small>
            </article>
            <article className="reports-kpi">
              <div className="reports-kpi-label"><span>Cycle time</span><Icon name="activity" size={15} /></div>
              <strong>{analytics?.medianCycleTimeHours || 0}<em>h</em></strong>
              <small>Median time from start to completion</small>
            </article>
          </div>

          <div className="reports-main-grid">
            <section className="report-surface">
              <div className="report-surface-head">
                <div><span className="section-kicker">Throughput</span><h3>Delivery rhythm</h3><p>Completed tasks over the most recent eight-week window.</p></div>
                <span className="surface-caption">8 weeks</span>
              </div>
              <div className="throughput-chart throughput-chart-refined" role="img" aria-label="Completed tasks over the most recent eight weeks">
                {!hasThroughputActivity ? (
                  <div className="report-chart-empty">
                    <Icon name="chart" size={18} />
                    <strong>{throughput.length ? 'No completed tasks in this period' : 'No delivery history yet'}</strong>
                    <span>{throughput.length ? 'The chart will fill in when the team completes tasks.' : 'Completed tasks will appear here as work ships.'}</span>
                  </div>
                ) : throughput.map((item) => {
                  const value = Number(item.completed || 0)
                  return (
                    <div className="throughput-column" key={item.week}>
                      <strong>{value}</strong>
                      <span><i style={{ height: Math.max(7, (value / maxThroughput) * 100) + '%' }} /></span>
                      <small>{item.week ? new Date(item.week).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}</small>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="report-surface">
              <div className="report-surface-head">
                <div><span className="section-kicker">Capacity</span><h3>Workload balance</h3><p>Active task distribution across the project team.</p></div>
                <Badge color={analytics?.workloadSpread >= 3 ? 'amber' : 'green'}>{analytics?.workloadSpread || 0} spread</Badge>
              </div>
              <div className="report-workload-list">
                {workload.map((item) => {
                  const member = projectTasks.find((task) => String(task.assigneeId) === String(item.userId))
                  const load = Number(item.activeTasks || 0)
                  return (
                    <div className="report-workload-row" key={String(item.userId)}>
                      <div><strong>{member?.assigneeName || 'Team member'}</strong><span>{load} active task{load === 1 ? '' : 's'}</span></div>
                      <div className="report-workload-bar"><i style={{ width: Math.round((load / maxWorkload) * 100) + '%' }} /></div>
                    </div>
                  )
                })}
                {!workload.length ? <div className="detail-empty">No active assigned work yet.</div> : null}
              </div>
            </section>
          </div>

          <section className="report-surface">
            <div className="report-surface-head">
              <div><span className="section-kicker">Kendram Insights</span><h3>What deserves attention</h3><p>Each signal explains the condition and the next useful action.</p></div>
              <Badge color={riskCount ? 'amber' : 'green'}>{riskCount ? riskCount + ' risk items' : 'Healthy'}</Badge>
            </div>
            <div className="reports-insights-grid reports-insights-refined">
              {insights.map((insight, index) => {
                const relatedTask = (insight.entityIds || []).map((id) => projectTaskMap.get(String(id))).find(Boolean)
                const canOpenTask = Boolean(relatedTask && onSelectTask)
                return (
                <button className="report-insight-card" type="button" key={insight.type || 'insight-' + index} disabled={!canOpenTask} aria-label={canOpenTask ? 'Open task for ' + (insight.signal || 'insight') : (insight.signal || 'Insight') + ': no linked task available'} onClick={() => {
                  if (canOpenTask) onSelectTask(relatedTask)
                }}>
                  <div className="report-insight-top"><Badge color={insightTone(insight.severity)}>{insight.severity || 'LOW'}</Badge><Icon name="chevron" size={15} /></div>
                  <strong>{insight.signal || 'Signal'}</strong>
                  <p>{insight.reason || 'No additional explanation is available for this signal.'}</p>
                  <span>{insight.action || 'Review the affected work.'}</span>
                  <small className="report-insight-availability">{canOpenTask ? 'Open related task' : 'No linked task'}</small>
                </button>
                )
              })}
              {!insights.length ? <div className="report-insights-empty"><Icon name="check-circle" size={18} /><strong>No active signals</strong><span>There are no actionable issues to highlight for this project right now.</span></div> : null}
            </div>
          </section>
        </>
      ) : (
        <section className="report-empty">
          <div className="report-empty-icon"><Icon name="chart" size={22} /></div>
          <h3>No project selected</h3>
          <p>Create or join a project to unlock live delivery analytics.</p>
        </section>
      )}
    </section>
  )
}
