#!/usr/bin/env node
/**
 * Repeatable read-only benchmark for the task-list endpoint.
 * Requires API_BASE_URL (e.g. https://your-api/api/v1), API_TOKEN and PROJECT_ID.
 * Run against a disposable environment containing at least 1,000 tasks in that project.
 */
const base = process.env.API_BASE_URL?.replace(/\/+$/, '')
const token = process.env.API_TOKEN
const projectId = process.env.PROJECT_ID
const iterations = Number(process.env.ITERATIONS || 100)

if (!base || !token || !projectId) {
  console.error('Set API_BASE_URL, API_TOKEN and PROJECT_ID before running this benchmark.')
  process.exit(2)
}
if (!Number.isInteger(iterations) || iterations < 10 || iterations > 10000) {
  console.error('ITERATIONS must be an integer between 10 and 10000.')
  process.exit(2)
}

const samples = []
let totalTasks = 0
for (let i = 0; i < iterations; i += 1) {
  const url = new URL(base + '/tasks/project/' + encodeURIComponent(projectId))
  url.searchParams.set('page', String((i % 10) + 1))
  url.searchParams.set('limit', '100')
  const start = performance.now()
  const response = await fetch(url, { headers: { Authorization: 'Bearer ' + token } })
  const elapsed = performance.now() - start
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    console.error('Request failed:', response.status, body.message || '')
    process.exit(1)
  }
  totalTasks = body.meta?.pagination?.total ?? totalTasks
  samples.push(elapsed)
}
if (totalTasks < 1000) {
  console.error('Benchmark invalid: API reports only', totalTasks, 'tasks; seed at least 1,000 tasks first.')
  process.exit(1)
}
samples.sort((a, b) => a - b)
const percentile = (p) => samples[Math.min(samples.length - 1, Math.ceil(p * samples.length) - 1)]
const summary = {
  endpoint: '/tasks/project/:projectId?page=N&limit=100',
  taskCount: totalTasks,
  iterations,
  p50Ms: Number(percentile(0.50).toFixed(2)),
  p95Ms: Number(percentile(0.95).toFixed(2)),
  maxMs: Number(samples[samples.length - 1].toFixed(2)),
  targetMs: 300,
  targetMetAtP95: percentile(0.95) < 300,
  note: 'Run on the same hardware/network used for the acceptance test; this script does not fabricate or guarantee a performance result.',
}
console.log(JSON.stringify(summary, null, 2))
