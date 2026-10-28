import { describe, expect, it } from 'vitest'
import { graphContainsPath } from '../../services/dependency.service.js'

describe('dependency graph rules', () => {
  it('detects an existing directed path', () => {
    const graph = new Map([
      ['A', ['B']],
      ['B', ['C']],
      ['C', []],
    ])

    expect(graphContainsPath(graph, 'A', 'C')).toBe(true)
    expect(graphContainsPath(graph, 'C', 'A')).toBe(false)
  })

  it('supports a branching dependency graph without false cycle detection', () => {
    const graph = new Map([
      ['A', ['B', 'C']],
      ['B', ['D']],
      ['C', ['D']],
      ['D', []],
    ])

    expect(graphContainsPath(graph, 'B', 'D')).toBe(true)
    expect(graphContainsPath(graph, 'D', 'A')).toBe(false)
  })

  it('stops traversal after the safety limit', () => {
    const graph = new Map()
    for (let index = 0; index < 20; index += 1) {
      graph.set(String(index), [String(index + 1)])
    }
    graph.set('20', [])

    expect(graphContainsPath(graph, '0', '20', 10)).toBe(true)
  })
})
