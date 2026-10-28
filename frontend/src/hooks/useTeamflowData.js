import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'

const statusLabel = { TODO: 'Todo', IN_PROGRESS: 'In Progress', REVIEW: 'Review', BLOCKED: 'Blocked', COMPLETED: 'Completed' }
const priorityLabel = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', CRITICAL: 'Critical' }

function initialsFor(name = 'Anvaya') {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

function mapTask(task, project, projectMembers = []) {
  const rawAssignee = task.assigneeId
  const assigneeId = rawAssignee && typeof rawAssignee === 'object' ? (rawAssignee._id || rawAssignee.id) : (rawAssignee || null)
  const assigneeMember = projectMembers.find((member) => String(member.id) === String(assigneeId) || String(member.userId) === String(assigneeId))
  const assigneeName = (rawAssignee && typeof rawAssignee === 'object' ? rawAssignee.name : '') || assigneeMember?.name || 'Unassigned'
  return {
    apiId: task._id,
    projectId: project._id,
    version: task.version || 1,
    labels: Array.isArray(task.labels) ? task.labels : [],
    id: String(task._id).slice(-6).toUpperCase(),
    title: task.title,
    project: project.name,
    assignee: assigneeName,
    assigneeName,
    assigneeId,
    priority: priorityLabel[task.priority] || task.priority,
    priorityValue: task.priority,
    status: statusLabel[task.status] || task.status,
    statusValue: task.status,
    due: task.dueDate
      ? new Date(task.dueDate).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })
      : 'Not set',
    dueDate: task.dueDate || null,
    estimateMinutes: task.estimateMinutes || null,
    dependencyCount: task.dependencyCount || 0,
    blockedByCount: task.blockedByCount || 0,
    blockingCount: task.blockingCount || 0,
    blockedByTaskIds: task.blockedByTaskIds || [],
    blockingTaskIds: task.blockingTaskIds || [],
    hasBlockingDependencies: Boolean(task.hasBlockingDependencies),
    createdAt: task.createdAt || null,
    completedAt: task.completedAt || null,
    description: task.description || '',
  }
}

function mapActivity(item) {
  return {
    initials: initialsFor(item.userId?.name),
    person: item.userId?.name || 'Anvaya',
    action: formatActivity(item),
    time: new Date(item.createdAt).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    tone: 'violet',
  }
}

function formatActivity(item) {
  if (item.action === 'TASK_CREATED') return 'created a new task'
  if (item.action === 'TASK_UPDATED') return 'updated a task'
  if (item.action === 'COMMENT_ADDED') return 'added a comment'
  return item.action.replaceAll('_', ' ').toLowerCase()
}

const WORKSPACE_CACHE_BASE = 'anvaya_workspace_cache_v4'
const WORKSPACE_CACHE_TTL = 1000 * 60 * 30

function readWorkspaceCache(userId) {
  try {
    const raw = localStorage.getItem(WORKSPACE_CACHE_BASE + ':' + String(userId || 'guest'))
    if (!raw) return null
    const cached = JSON.parse(raw)
    if (!cached?.savedAt || Date.now() - cached.savedAt > WORKSPACE_CACHE_TTL) return null
    return cached.state || null
  } catch {
    return null
  }
}

function writeWorkspaceCache(userId, state) {
  try {
    localStorage.setItem(WORKSPACE_CACHE_BASE + ':' + String(userId || 'guest'), JSON.stringify({ savedAt: Date.now(), state }))
  } catch {
    // Cache is an optimization only.
  }
}

function mapProject(project, projectTasks, projectMembers, index) {
  const totalTasks = projectTasks.length
  const completedTasks = projectTasks.filter((task) => task.statusValue === 'COMPLETED').length

  return {
    ...project,
    memberCount: projectMembers.length,
    taskCount: totalTasks,
    completedTaskCount: completedTasks,
    progress: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0,
    tone: ['violet', 'blue', 'green'][index % 3],
    members: projectMembers,
  }
}

export function useTeamflowData(enabled, userId, scope = 'Overview') {
  const [refreshKey, setRefreshKey] = useState(0)
  const [state, setState] = useState(() => ({
    loading: false,
    connected: false,
    error: '',
    summary: null,
    projects: [],
    tasks: [],
    members: [],
    membersByProject: {},
    activity: [],
    notifications: [],
    invitations: [],
    ...(readWorkspaceCache(userId) || {}),
    loading: false,
  }))

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), [])

  useEffect(() => {
    let cancelled = false
    if (!enabled) return undefined

    const load = async () => {
      setState((current) => ({ ...current, loading: true, error: '' }))

      try {
        // Load the smallest useful dataset for the current page. This avoids
        // fetching every project's tasks and members just to open /team.
        const needsTasks = ['Overview', 'Projects', 'My Tasks', 'Reports'].includes(scope)
        const needsMembers = ['Overview', 'Projects', 'Team'].includes(scope)
        const needsActivity = scope === 'Overview'
        const needsDashboard = scope === 'Overview'

        const [projectsResult, notificationResult, dashboardResult, activityResult, invitationResult] = await Promise.all([
          api.listProjects(),
          api.listNotifications(),
          needsDashboard ? api.dashboard() : Promise.resolve({ data: null }),
          needsActivity ? api.listActivity() : Promise.resolve({ data: [] }),
          scope === 'Team' ? api.listMyInvitations() : Promise.resolve({ data: [] }),
        ])

        const projectList = projectsResult.data || []
        const projectResults = await Promise.all(
          projectList.map(async (project) => {
            const [taskResult, memberResult] = await Promise.all([
              needsTasks ? api.listTasks(project._id) : Promise.resolve({ data: [] }),
              needsMembers ? api.listMembers(project._id) : Promise.resolve({ data: [] }),
            ])
            return {
              project,
              taskResult,
              members: (memberResult.data || [])
                .filter((item) => item.userId || item.id)
                .map((item, memberIndex) => {
                  const nestedUser = item.userId && typeof item.userId === 'object' ? item.userId : null
                  const name = item.name || nestedUser?.name || 'Team member'
                  return {
                    id: (typeof item.userId === 'string' ? item.userId : nestedUser?._id) || item.id || item._id,
                    userId: (typeof item.userId === 'string' ? item.userId : nestedUser?._id) || item.id || item._id,
                    memberId: item.memberId || item._id || item.id,
                    name,
                    email: item.email || nestedUser?.email || '',
                    role: item.role || nestedUser?.role || 'TEAM_MEMBER',
                    projectRole: item.projectRole || 'MEMBER',
                    status: item.status || nestedUser?.status || 'ACTIVE',
                    initials: initialsFor(name),
                    tone: ['violet', 'blue', 'green', 'amber', 'rose'][memberIndex % 5],
                  }
                }),
            }
          }),
        )

        projectResults.forEach((item) => {
          item.tasks = (item.taskResult?.data || []).map((task) => mapTask(task, item.project, item.members))
        })

        const allTasks = projectResults.flatMap((item) => item.tasks)
        const projectMembers = {}
        projectResults.forEach((item) => {
          projectMembers[item.project._id] = item.members
        })

        const memberMap = new Map()
        projectResults.forEach((item) => {
          const loadMap = new Map()
          for (const task of item.tasks) {
            if (task.assigneeId && task.statusValue !== 'COMPLETED') {
              loadMap.set(String(task.assigneeId), (loadMap.get(String(task.assigneeId)) || 0) + 1)
            }
          }
          item.members.forEach((member) => {
            const key = String(member.id)
            const existing = memberMap.get(key)
            if (existing) {
              existing.activeTasks += loadMap.get(key) || 0
              if (!existing.projectIds.includes(item.project._id)) existing.projectIds.push(item.project._id)
            } else {
              memberMap.set(key, { ...member, activeTasks: loadMap.get(key) || 0, projectIds: [item.project._id] })
            }
          })
        })

        const projects = projectResults.map((item, index) => mapProject(item.project, item.tasks, item.members, index))

        if (!cancelled) {
          const cached = readWorkspaceCache(userId)
          const nextState = {
            ...(cached || {}),
            loading: false,
            connected: true,
            error: '',
            summary: dashboardResult.data ?? cached?.summary ?? null,
            projects,
            tasks: needsTasks ? allTasks : (cached?.tasks || []),
            members: needsMembers ? [...memberMap.values()] : (cached?.members || []),
            membersByProject: needsMembers ? projectMembers : (cached?.membersByProject || {}),
            activity: needsActivity ? (activityResult.data || []).map(mapActivity) : (cached?.activity || []),
            notifications: (notificationResult.data || []).map((item) => ({ ...item, unread: !item.readAt })),
            invitations: scope === 'Team' ? (invitationResult.data || []) : (cached?.invitations || []),
          }
          setState(nextState)
          writeWorkspaceCache(userId, nextState)
        }
      } catch (error) {
        if (!cancelled) {
          setState((current) => ({ ...current, loading: false, error: current.connected ? '' : error.message }))
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [enabled, refreshKey, userId, scope])

  return { ...state, refresh }
}
