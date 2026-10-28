import Icon from '../components/Icon'
import StatCard from '../components/StatCard'
import SectionHeader from '../components/SectionHeader'
import ProjectCard from '../components/ProjectCard'
import TaskTable from '../components/TaskTable'
import ActivityFeed from '../components/ActivityFeed'
import WorkloadCard from '../components/WorkloadCard'
import { activity as mockActivity, projects as mockProjects, stats as mockStats, tasks as mockTasks, workload as mockWorkload } from '../data/teamflowMock'

function mapRemoteStats(summary) {
  if (!summary) return mockStats
  return [
    { label: 'Active Projects', value: String(summary.activeProjects || 0).padStart(2, '0'), change: 'From live workspace', tone: 'violet', icon: 'folder' },
    { label: 'Open Tasks', value: String(summary.openTasks || 0).padStart(2, '0'), change: 'From live workspace', tone: 'blue', icon: 'check' },
    { label: 'Completed', value: String(summary.completedTasks || 0).padStart(2, '0'), change: 'From live workspace', tone: 'green', icon: 'activity' },
    { label: 'Overdue', value: String(summary.overdueTasks || 0).padStart(2, '0'), change: (summary.overdueTasks || 0) ? 'Needs attention' : 'No overdue tasks', tone: 'rose', icon: 'alert' },
  ]
}

function greetingForHour(hour) {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function formatToday() {
  return new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function Overview({ onNavigate, onCreateTask, onSuggestAssignee, onSelectTask, liveData, user }) {
  const remoteMode = liveData.connected
  const displayStats = remoteMode ? mapRemoteStats(liveData.summary) : mockStats

  const displayProjects = remoteMode
    ? liveData.projects.map((project) => ({
        name: project.name,
        meta: (project.status || 'PLANNING').replaceAll('_', ' ') + ' · ' + (project.memberCount || 0) + ' members',
        progress: project.progress || 0,
        tone: project.tone || 'violet',
        due: project.dueDate ? new Date(project.dueDate).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }) : 'No due date',
        tasks: (project.completedTaskCount || 0) + ' / ' + (project.taskCount || 0) + ' tasks',
        members: project.members || [],
      }))
    : mockProjects

  const displayTasks = remoteMode ? liveData.tasks : mockTasks
  const displayActivity = remoteMode ? liveData.activity : mockActivity

  const displayWorkload = remoteMode
    ? liveData.members.map((member) => ({
        initials: member.initials,
        name: member.name,
        tasks: member.activeTasks,
        status: member.activeTasks <= 5 ? 'Light' : member.activeTasks <= 7 ? 'Balanced' : 'Busy',
        tone: member.tone,
      }))
    : mockWorkload

  const userName = user?.name || 'there'
  const firstName = userName.trim().split(/\s+/)[0] || userName
  const today = formatToday()
  const greeting = greetingForHour(new Date().getHours())

  return (
    <div className="page-stack">
      <section className="hero-card">
        <div className="hero-copy">
          <span className="hero-kicker">{remoteMode ? 'Live workspace' : 'Demo workspace'} · {today}</span>
          <h1>{greeting}, {firstName}</h1>
          <p>{remoteMode ? 'Your dashboard is connected to the Kendram API.' : 'Here is what is happening across your demo workspace today.'}</p>
          <div className="hero-actions">
            <button className="primary-button" onClick={() => onNavigate('My Tasks')}><Icon name="check" size={16} /> Review my tasks</button>
            <button className="ghost-button" onClick={onCreateTask}><Icon name="plus" size={16} /> Create task</button>
          </div>
        </div>
        <div className="hero-orbit"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="hero-spark"><Icon name="spark" size={30} /></div></div>
      </section>

      {liveData.error ? <div className="api-banner"><span>API connection unavailable</span><small>{liveData.error}</small></div> : null}

      <section className="stats-grid">{displayStats.map((item) => <StatCard key={item.label} item={item} />)}</section>

      <section>
        <SectionHeader title="Active projects" subtitle={remoteMode ? 'Projects currently available to your account.' : 'A quick snapshot of the demo workspace.'} action="View all projects" onAction={() => onNavigate('Projects')} />
        <div className="project-grid">
          {displayProjects.length
            ? displayProjects.map((project, index) => <ProjectCard key={(project.apiId || project.name) + index} project={project} />)
            : <div className="empty-state">No projects yet. Create a project or ask a project manager to add you to one.</div>}
        </div>
      </section>

      <section className="content-grid content-grid-main">
        <div className="panel task-panel">
          <SectionHeader title="Priority tasks" subtitle={remoteMode ? 'Tasks currently visible to your account.' : 'The work most likely to need your attention.'} action="Open task board" onAction={() => onNavigate('My Tasks')} />
          <TaskTable tasks={displayTasks} onSelectTask={onSelectTask} />
        </div>
        <WorkloadCard members={displayWorkload} onSuggest={remoteMode && liveData.projects.length ? onSuggestAssignee : undefined} />
      </section>

      <section className="content-grid content-grid-bottom">
        <div className="panel">
          <SectionHeader title="Recent activity" subtitle={remoteMode ? 'Recent activity visible in your workspace.' : 'A lightweight audit trail of the demo workspace.'} />
          <ActivityFeed items={displayActivity} />
        </div>
        <CompletionTrend remoteMode={remoteMode} tasks={liveData.tasks} />
      </section>
    </div>
  )
}

function CompletionTrend({ remoteMode, tasks }) {
  if (!remoteMode) {
    return (
      <div className="panel">
        <SectionHeader title="Completion trend" subtitle="Demo completion trend for the UI preview." />
        <div className="trend-chart">{[42, 55, 48, 72, 60, 82, 76].map((v, i) => <div className="trend-column" key={i}><div className="trend-bar" style={{ height: v + '%' }} /></div>)}</div>
        <div className="trend-footer"><strong>+18%</strong><span>vs previous week</span></div>
      </div>
    )
  }

  const completed = tasks.filter((task) => task.statusValue === 'COMPLETED').length
  const total = tasks.length
  const completion = total ? Math.round((completed / total) * 100) : 0
  const statusCounts = ['TODO', 'IN_PROGRESS', 'REVIEW', 'BLOCKED', 'COMPLETED'].map((status) => tasks.filter((task) => task.statusValue === status).length)
  const max = Math.max(...statusCounts, 1)

  return (
    <div className="panel">
      <SectionHeader title="Task status" subtitle="Current distribution of your visible tasks." />
      {total ? (
        <>
          <div className="trend-chart trend-chart-status">{statusCounts.map((value, i) => <div className="trend-column" key={i}><div className="trend-bar" style={{ height: Math.max(14, (value / max) * 100) + '%' }} /></div>)}</div>
          <div className="trend-footer"><strong>{completion}%</strong><span>{completed} of {total} tasks completed</span></div>
        </>
      ) : (
        <div className="empty-state">No tasks available yet, so there is no completion trend to show.</div>
      )}
    </div>
  )
}
