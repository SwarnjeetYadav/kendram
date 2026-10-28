import mongoose from 'mongoose'
import Task from '../models/Task.js'
import ProjectMember from '../models/ProjectMember.js'
import TaskDependency from '../models/TaskDependency.js'

function hoursUntil(date) {
  return (new Date(date).getTime() - Date.now()) / 36e5
}

export async function getProjectInsights(projectId) {
  if (!mongoose.isValidObjectId(projectId)) throw new Error('Invalid project id')

  const [tasks, members, dependencies] = await Promise.all([
    Task.find({ projectId }).lean(),
    ProjectMember.find({ projectId }).select('userId projectRole').lean(),
    TaskDependency.find({ projectId }).select('predecessorTaskId successorTaskId').lean(),
  ])

  const insights = []
  const active = tasks.filter((task) => task.status !== 'COMPLETED')

  const deadlineRisk = active.filter((task) => task.dueDate && hoursUntil(task.dueDate) <= 48 && hoursUntil(task.dueDate) >= -168)
  if (deadlineRisk.length) {
    insights.push({
      type: 'DEADLINE_RISK',
      severity: deadlineRisk.some((task) => hoursUntil(task.dueDate) < 0) ? 'HIGH' : 'MEDIUM',
      signal: deadlineRisk.length + ' task' + (deadlineRisk.length === 1 ? ' is' : 's are') + ' at risk',
      reason: 'Due within 48 hours or already overdue while still open.',
      action: 'Review due dates and unblock or reassign the affected work.',
      entityIds: deadlineRisk.map((task) => task._id),
    })
  }

  const load = new Map()
  for (const task of active) {
    if (!task.assigneeId) continue
    const key = String(task.assigneeId)
    load.set(key, (load.get(key) || 0) + 1)
  }
  const loadValues = [...load.values()]
  if (loadValues.length >= 2) {
    const max = Math.max(...loadValues)
    const min = Math.min(...loadValues)
    if (max >= 3 && max - min >= 3) {
      const overloadedUserId = [...load.entries()].sort((a, b) => b[1] - a[1])[0][0]
      insights.push({
        type: 'WORKLOAD_IMBALANCE',
        severity: max >= 6 ? 'HIGH' : 'MEDIUM',
        signal: 'Workload is uneven across the active team',
        reason: 'One member carries ' + max + ' active tasks while another carries only ' + min + '.',
        action: 'Review the overloaded member and redistribute eligible work.',
        entityIds: [overloadedUserId],
      })
    }
  }

  const collisionTasks = active.filter((task) => {
    if (!task.assigneeId || task.priority === 'LOW' || !task.dueDate) return false
    const due = hoursUntil(task.dueDate)
    return due <= 72
  })
  if (collisionTasks.length >= 2) {
    insights.push({
      type: 'ASSIGNMENT_CONFLICT',
      severity: collisionTasks.some((task) => task.priority === 'CRITICAL') ? 'HIGH' : 'MEDIUM',
      signal: collisionTasks.length + ' high-priority tasks have near-term deadlines',
      reason: 'Multiple important tasks are converging on the same delivery window.',
      action: 'Review Smart Assignment suggestions before the next hand-off.',
      entityIds: collisionTasks.map((task) => task._id),
    })
  }

  const predecessorBySuccessor = new Map()
  dependencies.forEach((edge) => {
    const key = String(edge.successorTaskId)
    const list = predecessorBySuccessor.get(key) || []
    list.push(String(edge.predecessorTaskId))
    predecessorBySuccessor.set(key, list)
  })

  const taskMap = new Map(tasks.map((task) => [String(task._id), task]))
  const blockedFlow = active.filter((task) => {
    const predecessors = predecessorBySuccessor.get(String(task._id)) || []
    return predecessors.some((id) => taskMap.get(id)?.status !== 'COMPLETED')
  })
  if (blockedFlow.length) {
    insights.push({
      type: 'BLOCKED_FLOW',
      severity: blockedFlow.some((task) => task.dueDate && hoursUntil(task.dueDate) < 0) ? 'HIGH' : 'MEDIUM',
      signal: blockedFlow.length + ' task' + (blockedFlow.length === 1 ? ' is' : 's are') + ' blocked',
      reason: 'Required predecessor work is incomplete.',
      action: 'Open the blocking task and move the dependency chain forward.',
      entityIds: blockedFlow.map((task) => task._id),
    })
  }

  const completed = tasks.filter((task) => task.status === 'COMPLETED').length
  const completionRate = tasks.length ? completed / tasks.length : 1
  let health = 'Healthy'
  if (blockedFlow.length || deadlineRisk.length >= 3) health = 'Watch'
  if (deadlineRisk.some((task) => hoursUntil(task.dueDate) < 0) || blockedFlow.filter((task) => task.dueDate && hoursUntil(task.dueDate) < 0).length) health = 'At Risk'

  const managerCount = members.filter((member) => member.projectRole === 'PROJECT_MANAGER').length
  insights.unshift({
    type: 'PROJECT_HEALTH',
    severity: health === 'Healthy' ? 'LOW' : health === 'Watch' ? 'MEDIUM' : 'HIGH',
    signal: health,
    reason: completionRate >= 0.75 ? 'Most tracked work is complete.' : managerCount ? 'Project has active managerial coverage but delivery risk remains.' : 'Project has limited completed work and needs attention.',
    action: health === 'Healthy' ? 'Keep the current delivery rhythm.' : 'Review the highest-risk signals below.',
    entityIds: [],
  })

  return insights.slice(0, 5)
}
