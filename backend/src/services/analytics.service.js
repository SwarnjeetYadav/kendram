import mongoose from 'mongoose'
import Task from '../models/Task.js'
import TaskDependency from '../models/TaskDependency.js'

function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function startOfWeek(date) {
  const value = new Date(date)
  const day = value.getDay()
  const diff = day === 0 ? -6 : 1 - day
  value.setDate(value.getDate() + diff)
  value.setHours(0, 0, 0, 0)
  return value
}

export async function getProjectAnalytics(projectId) {
  if (!mongoose.isValidObjectId(projectId)) throw new Error('Invalid project id')

  const tasks = await Task.find({ projectId }).lean()
  const dependencies = await TaskDependency.find({ projectId }).select('successorTaskId predecessorTaskId').lean()

  const total = tasks.length
  const completed = tasks.filter((task) => task.status === 'COMPLETED').length
  const overdue = tasks.filter((task) => task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'COMPLETED').length
  const blocked = tasks.filter((task) => task.status === 'BLOCKED').length

  const cycleHours = tasks
    .filter((task) => task.startedAt && task.completedAt)
    .map((task) => (new Date(task.completedAt) - new Date(task.startedAt)) / 36e5)
    .filter(Number.isFinite)

  const throughput = new Map()
  for (const task of tasks) {
    if (!task.completedAt) continue
    const week = startOfWeek(task.completedAt).toISOString().slice(0, 10)
    throughput.set(week, (throughput.get(week) || 0) + 1)
  }

  const weeks = Array.from({ length: 8 }, (_, index) => {
    const date = new Date()
    date.setDate(date.getDate() - (7 - index) * 7)
    const key = startOfWeek(date).toISOString().slice(0, 10)
    return { week: key, completed: throughput.get(key) || 0 }
  })

  const workloads = new Map()
  for (const task of tasks) {
    if (!task.assigneeId || task.status === 'COMPLETED') continue
    const key = String(task.assigneeId)
    workloads.set(key, (workloads.get(key) || 0) + 1)
  }
  const workloadValues = [...workloads.values()]

  return {
    totalTasks: total,
    completedTasks: completed,
    completionRate: total ? Math.round((completed / total) * 100) : 0,
    overdueTasks: overdue,
    overdueRate: total ? Math.round((overdue / total) * 100) : 0,
    blockedTasks: blocked,
    dependencyCount: dependencies.length,
    medianCycleTimeHours: Math.round(median(cycleHours) * 10) / 10,
    throughput: weeks,
    workload: [...workloads.entries()].map(([userId, activeTasks]) => ({ userId, activeTasks })),
    workloadSpread: workloadValues.length ? Math.max(...workloadValues) - Math.min(...workloadValues) : 0,
  }
}
