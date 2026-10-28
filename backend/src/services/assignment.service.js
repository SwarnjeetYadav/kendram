import mongoose from 'mongoose'
import ProjectMember from '../models/ProjectMember.js'
import Task from '../models/Task.js'

export const ASSIGNMENT_WEIGHTS = Object.freeze({
  workloadFit: 0.30,
  dueDateFit: 0.25,
  roleFit: 0.20,
  priorityFit: 0.15,
  availabilityFit: 0.10,
})

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

function roleFit(projectRole, priority) {
  if (priority === 'CRITICAL' || priority === 'HIGH') {
    return projectRole === 'PROJECT_MANAGER' ? 1 : 0.9
  }
  return projectRole === 'MEMBER' ? 1 : 0.9
}

function explainCandidate(candidate) {
  const reasons = []
  if (candidate.workloadFit >= 0.8) reasons.push('workload is low')
  else if (candidate.workloadFit < 0.5) reasons.push('workload is high')

  if (candidate.roleFit >= 0.95) reasons.push('role matches')
  if (candidate.dueDateFit >= 0.8) reasons.push('no near-term due conflict')
  else if (candidate.dueDateFit < 0.5) reasons.push('several due-date conflicts')

  if (candidate.priorityFit >= 0.8) reasons.push('priority load is manageable')
  if (candidate.availabilityFit >= 0.8) reasons.push('availability looks healthy')

  return reasons.slice(0, 3).join(', ') || 'best available workload profile'
}

export async function suggestAssignees({ projectId, priority = 'MEDIUM', dueDate = null, estimateMinutes = null } = {}) {
  if (!mongoose.isValidObjectId(projectId)) return []

  const members = await ProjectMember.find({ projectId, projectRole: { $ne: 'VIEWER' } })
    .select('userId projectRole')
    .populate('userId', 'name email role')
    .lean()

  if (!members.length) return []

  const memberIds = members.map((member) => member.userId?._id || member.userId)
  const activeTasks = await Task.find({
    projectId,
    assigneeId: { $in: memberIds },
    status: { $ne: 'COMPLETED' },
  })
    .select('assigneeId dueDate priority estimateMinutes status')
    .lean()

  const maxLoad = Math.max(...members.map((member) => {
    const memberUserId = member.userId?._id || member.userId
    return activeTasks.filter((task) => String(task.assigneeId) === String(memberUserId)).length
  }), 0)
  const scored = members.map((member) => {
    const memberUserId = member.userId?._id || member.userId
    const mine = activeTasks.filter((task) => String(task.assigneeId) === String(memberUserId))
    const activeCount = mine.length
    const totalMinutes = mine.reduce((sum, task) => sum + (task.estimateMinutes || 60), 0)
    const workloadFit = maxLoad === 0 ? 1 : clamp(1 - (activeCount / Math.max(maxLoad, 1)))
    const effectiveDue = dueDate ? new Date(dueDate).getTime() : null
    const dueConflicts = effectiveDue
      ? mine.filter((task) => task.dueDate && Math.abs(new Date(task.dueDate).getTime() - effectiveDue) <= 72 * 36e5).length
      : 0
    const dueDateFit = effectiveDue ? clamp(1 - (dueConflicts / Math.max(activeCount, 1))) : 1
    const roleScore = roleFit(member.projectRole, priority)
    const highPriorityConflicts = mine.filter((task) => ['HIGH', 'CRITICAL'].includes(task.priority) && task.dueDate && new Date(task.dueDate).getTime() < Date.now() + 72 * 36e5).length
    const priorityFit = clamp(1 - (highPriorityConflicts / 2))
    const projectedMinutes = estimateMinutes || 60
    const availabilityFit = clamp(1 - (Math.max(0, totalMinutes + projectedMinutes - 480) / 960))

    const assignmentScore = (
      ASSIGNMENT_WEIGHTS.workloadFit * workloadFit
      + ASSIGNMENT_WEIGHTS.dueDateFit * dueDateFit
      + ASSIGNMENT_WEIGHTS.roleFit * roleScore
      + ASSIGNMENT_WEIGHTS.priorityFit * priorityFit
      + ASSIGNMENT_WEIGHTS.availabilityFit * availabilityFit
    )

    const result = {
      userId: memberUserId,
      user: member.userId?.name ? { name: member.userId.name, email: member.userId.email, role: member.userId.role } : null,
      projectRole: member.projectRole,
      activeTaskCount: activeCount,
      activeMinutes: totalMinutes,
      workloadFit,
      dueDateFit,
      roleFit: roleScore,
      priorityFit,
      availabilityFit,
      assignmentScore: Number(assignmentScore.toFixed(3)),
    }

    return {
      ...result,
      reason: explainCandidate(result),
    }
  })

  return scored.sort((a, b) => b.assignmentScore - a.assignmentScore).slice(0, 3)
}

export async function suggestAssignee(projectId, taskContext = {}) {
  const suggestions = await suggestAssignees({ projectId, ...taskContext })
  return suggestions[0]?.userId || null
}
