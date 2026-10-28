import { useEffect, useState } from 'react'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'
import CreateTaskModal from './components/CreateTaskModal'
import CreateProjectModal from './components/CreateProjectModal'
import TaskDetailsModal from './components/TaskDetailsModal'
import { projects as demoProjects } from './data/teamflowMock'
import Overview from './pages/Overview'
import Login from './pages/Login'
import { GenericPage } from './pages'
import { useAuth } from './auth/AuthProvider'
import { useTeamflowData } from './hooks/useTeamflowData'
import { api } from './lib/api'
import LegalPage from './pages/LegalPage'
import CookieConsent from './components/CookieConsent'

const ROUTES = {
  Overview: '/',
  Projects: '/projects',
  'My Tasks': '/my-tasks',
  Team: '/team',
  Calendar: '/calendar',
  Reports: '/reports',
  Settings: '/settings',
}

function pageFromPath(pathname) {
  const match = Object.entries(ROUTES).find(([, path]) => path === pathname)
  return match?.[0] || 'Overview'
}

function LoadingScreen() {
  return (
    <div className="auth-loading-screen" role="status" aria-live="polite">
      <div className="youtube-skeleton-brand"><span>KE</span></div>
      <div className="youtube-skeleton-title" />
      <div className="youtube-skeleton-subtitle" />
    </div>
  )
}

function WorkspaceSkeleton() {
  return (
    <div className="youtube-workspace-skeleton" aria-busy="true" aria-label="Loading workspace">
      <div className="youtube-skeleton-heading">
        <span />
        <i />
        <i />
      </div>
      <div className="youtube-skeleton-cards">
        {[1, 2, 3, 4].map((item) => (
          <div className="youtube-skeleton-card" key={item}>
            <span />
            <i />
            <b />
            <em />
          </div>
        ))}
      </div>
      <div className="youtube-skeleton-large">
        <div className="youtube-skeleton-large-head"><span /><i /></div>
        <div className="youtube-skeleton-large-body">
          {[1, 2, 3, 4, 5, 6].map((item) => <div key={item}><span /><i /><b /><em /></div>)}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const { user, logout, demoMode, authLoading } = useAuth()
  const [page, setPage] = useState(() => pageFromPath(window.location.pathname))
  const liveData = useTeamflowData(Boolean(user) && !demoMode, user?.id, page)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [projectModalOpen, setProjectModalOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState(null)
  const [taskPrefillDueDate, setTaskPrefillDueDate] = useState('')
  const [demoTasks, setDemoTasks] = useState([])

  useEffect(() => {
    const handlePopState = () => setPage(pageFromPath(window.location.pathname))
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    const currentPath = window.location.pathname
    if (currentPath === '/privacy-policy' || currentPath === '/terms-and-conditions' || currentPath === '/404' || (currentPath !== '/auth/login' && !Object.values(ROUTES).includes(currentPath))) return
    if (authLoading) return

    if (!user) {
      if (window.location.pathname !== '/auth/login') {
        window.history.replaceState({}, '', '/auth/login')
      }
      return
    }

    if (window.location.pathname === '/auth/login') {
      window.history.replaceState({}, '', ROUTES[page] || '/')
      setPage((current) => Object.prototype.hasOwnProperty.call(ROUTES, current) ? current : 'Overview')
    }
  }, [user, authLoading, page])

  const currentPath = window.location.pathname
  if (currentPath === '/privacy-policy') return <LegalPage type="privacy" />
  if (currentPath === '/terms-and-conditions') return <LegalPage type="terms" />
  if (currentPath === '/404' || (currentPath !== '/auth/login' && !Object.values(ROUTES).includes(currentPath))) {
    return <div className="not-found-page"><span className="eyebrow">KENDRAM · 404</span><h1>That page has wandered off.</h1><p>The link may be outdated, or the page may have moved.</p><a className="primary-button primary-button-dark" href="/">Return to Kendram</a><CookieConsent /></div>
  }
  if (authLoading) return <LoadingScreen />
  if (!user) return <Login />

  const activeData = demoMode
    ? { connected: false, loading: false, error: '', summary: null, projects: demoProjects, tasks: demoTasks, members: [], membersByProject: {}, activity: [], notifications: [], refresh: () => {} }
    : liveData

  const openTaskCreator = (dueDate = '') => {
    setTaskPrefillDueDate(dueDate || '')
    setTaskModalOpen(true)
  }

  const navigate = (nextPage) => {
    const nextPath = ROUTES[nextPage] || '/'
    if (window.location.pathname !== nextPath) {
      window.history.pushState({ page: nextPage }, '', nextPath)
    }
    setPage(nextPage)
    setSelectedTask(null)
    setTaskPrefillDueDate('')
    setSidebarOpen(false)
  }

  const handleCreateTask = async (payload) => {
    if (demoMode) {
      setDemoTasks((items) => [{ ...payload, id: payload.id || 'AN-' + Date.now() }, ...items])
      setTaskModalOpen(false)
      navigate('My Tasks')
      return
    }
    await api.createTask(payload.projectId, payload.payload)
    setTaskModalOpen(false)
    navigate('My Tasks')
    liveData.refresh()
  }

  const handleCreateProject = async (payload) => {
    if (demoMode) return
    await api.createProject(payload)
    setProjectModalOpen(false)
    navigate('Projects')
    liveData.refresh()
  }

  const handleMarkNotificationRead = async (notificationId) => {
    await api.markNotificationRead(notificationId)
    liveData.refresh()
  }

  return (
    <div className="app-shell">
      <CookieConsent />
      <Sidebar page={page} onNavigate={navigate} open={sidebarOpen} onClose={() => setSidebarOpen(false)} user={user} liveData={activeData} />

      <div className="app-main">
        <Topbar
          page={page}
          onOpenMenu={() => setSidebarOpen(true)}
          onLogout={logout}
          onExitDemo={logout}
          demoMode={demoMode}
          notifications={activeData.notifications}
          onMarkRead={handleMarkNotificationRead}
          user={user}
          onNavigate={navigate}
          onSelectTask={setSelectedTask}
        />

        <main className="content">
          {!demoMode && liveData.loading && !liveData.connected ? (
            <WorkspaceSkeleton />
          ) : page === 'Overview' ? (
            <Overview
              onNavigate={navigate}
              onCreateTask={() => openTaskCreator()}
              onSuggestAssignee={() => openTaskCreator()}
              onSelectTask={setSelectedTask}
              liveData={activeData}
              user={user}
            />
          ) : (
            <GenericPage
              page={page}
              taskRows={activeData.tasks}
              onCreateTask={() => openTaskCreator()}
              onCreateTaskForDate={(date) => openTaskCreator(date)}
              onOpenTeam={() => navigate('Team')}
              onCreateProject={() => setProjectModalOpen(true)}
              onSelectTask={setSelectedTask}
              liveData={activeData}
              currentUserId={user.id}
              currentUser={user}
              canCreateProjects={!demoMode}
              onMembersChanged={liveData.refresh}
              invitations={activeData.invitations || []}
            />
          )}
        </main>
      </div>

      {sidebarOpen ? <button className="mobile-overlay" type="button" onClick={() => setSidebarOpen(false)} aria-label="Close navigation" /> : null}

      <CreateTaskModal
        open={taskModalOpen}
        onClose={() => setTaskModalOpen(false)}
        onCreate={handleCreateTask}
        liveMode={!demoMode}
        projects={!demoMode ? activeData.projects : []}
        membersByProject={!demoMode ? activeData.membersByProject : {}}
        demoProject={demoProjects[0]}
        initialDueDate={taskPrefillDueDate}
      />

      <CreateProjectModal
        open={projectModalOpen}
        onClose={() => setProjectModalOpen(false)}
        onCreate={handleCreateProject}
      />

      <TaskDetailsModal
        task={selectedTask}
        open={Boolean(selectedTask)}
        liveMode={!demoMode}
        projectMembers={!demoMode && selectedTask ? (activeData.membersByProject[selectedTask.projectId] || []) : []}
        projectTasks={!demoMode && selectedTask ? activeData.tasks.filter((item) => String(item.projectId) === String(selectedTask.projectId)) : []}
        canEditTask={demoMode || user.role === 'ADMINISTRATOR' || activeData.membersByProject?.[selectedTask?.projectId]?.find((item) => String(item.id) === String(user.id))?.projectRole !== 'VIEWER'}
        onClose={() => setSelectedTask(null)}
        onChanged={liveData.refresh}
      />
    </div>
  )
}
