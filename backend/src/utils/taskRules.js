export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'REVIEW', 'BLOCKED', 'COMPLETED']

export function isValidPriority(value) {
  return TASK_PRIORITIES.includes(value)
}

export function isValidStatus(value) {
  return TASK_STATUSES.includes(value)
}
