import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../models/ProjectMember.js', () => ({
  default: { find: vi.fn() },
}))

vi.mock('../models/Task.js', () => ({
  default: { find: vi.fn() },
}))

import ProjectMember from '../models/ProjectMember.js'
import Task from '../models/Task.js'
import { suggestAssignee } from '../services/assignment.service.js'

function memberQuery(value) {
  return {
    select: () => ({
      populate: () => ({
        lean: async () => value,
      }),
    }),
  }
}

function taskQuery(value) {
  return {
    select: () => ({
      lean: async () => value,
    }),
  }
}

describe('suggestAssignee', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null when there are no members', async () => {
    ProjectMember.find.mockReturnValue(memberQuery([]))
    expect(await suggestAssignee('507f1f77bcf86cd799439011')).toBeNull()
  })

  it('selects the least loaded eligible member', async () => {
    const first = '507f1f77bcf86cd799439011'
    const second = '507f1f77bcf86cd799439012'
    ProjectMember.find.mockReturnValue(memberQuery([
      { userId: first, projectRole: 'MEMBER' },
      { userId: second, projectRole: 'MEMBER' },
    ]))
    Task.find.mockReturnValue(taskQuery([
      { assigneeId: first, status: 'IN_PROGRESS', priority: 'MEDIUM', estimateMinutes: 60 },
      { assigneeId: first, status: 'TODO', priority: 'LOW', estimateMinutes: 60 },
      { assigneeId: first, status: 'REVIEW', priority: 'HIGH', estimateMinutes: 60 },
    ]))

    expect(await suggestAssignee('507f1f77bcf86cd799439013')).toBe(second)
  })
})
