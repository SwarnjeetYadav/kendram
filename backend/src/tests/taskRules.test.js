import { describe, expect, it } from 'vitest'
import { isValidPriority, isValidStatus } from '../utils/taskRules.js'

describe('task rules', () => {
  it('accepts supported priorities', () => {
    expect(isValidPriority('LOW')).toBe(true)
    expect(isValidPriority('CRITICAL')).toBe(true)
  })

  it('rejects unsupported priorities', () => {
    expect(isValidPriority('URGENT')).toBe(false)
  })

  it('accepts supported statuses', () => {
    expect(isValidStatus('TODO')).toBe(true)
    expect(isValidStatus('COMPLETED')).toBe(true)
  })

  it('rejects unsupported statuses', () => {
    expect(isValidStatus('DONE')).toBe(false)
  })
})
