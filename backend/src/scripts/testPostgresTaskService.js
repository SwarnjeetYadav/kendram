import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { getPostgresPool, closePostgresPool } from '../db/postgres.js'
import { createPostgresTask, listPostgresTasks, updatePostgresTask } from '../services/postgresTask.service.js'

function assert(ok, message) {
  if (!ok) throw new Error(message)
}
async function expectStatus(work, expected, message) {
  try { await work() } catch (error) {
    assert(error.statusCode === expected, `${message}: expected HTTP ${expected}, got ${error.statusCode} (${error.message})`)
    return
  }
  throw new Error(`${message}: expected HTTP ${expected}, but operation succeeded`)
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for PostgreSQL task integration tests')
  const pool = getPostgresPool()
  const suffix = randomUUID()
  const ownerLegacy = suffix.replaceAll('-', '').slice(0, 24)
  const outsiderLegacy = randomUUID().replaceAll('-', '').slice(0, 24)
  const projectLegacy = randomUUID().replaceAll('-', '').slice(0, 24)
  let ownerId, outsiderId, viewerId, projectId
  try {
    const owner = await pool.query(
      `INSERT INTO users (name,email,password_hash,legacy_mongo_id)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      ['Task integration owner', `owner-${suffix}@example.test`, 'test-only-hash', ownerLegacy],
    )
    ownerId = owner.rows[0].id
    const outsider = await pool.query(
      `INSERT INTO users (name,email,password_hash,legacy_mongo_id)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      ['Task integration outsider', `outsider-${suffix}@example.test`, 'test-only-hash', outsiderLegacy],
    )
    outsiderId = outsider.rows[0].id
    const viewerLegacy = randomUUID().replaceAll('-', '').slice(0, 24)
    const viewer = await pool.query(
      `INSERT INTO users (name,email,password_hash,legacy_mongo_id)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      ['Task integration viewer', `viewer-${suffix}@example.test`, 'test-only-hash', viewerLegacy],
    )
    viewerId = viewer.rows[0].id
    const project = await pool.query(
      `INSERT INTO projects (name,owner_id,status,legacy_mongo_id)
       VALUES ($1,$2,'ACTIVE',$3) RETURNING id`,
      [`Task integration project ${suffix.slice(0, 8)}`, ownerId, projectLegacy],
    )
    projectId = project.rows[0].id
    const board = await pool.query(
      'INSERT INTO boards (project_id,name,created_by) VALUES ($1,$2,$3) RETURNING id',
      [projectId, 'Integration board', ownerId],
    )
    await pool.query(
      'INSERT INTO project_members (project_id,user_id,project_role) VALUES ($1,$2,$3)',
      [projectId, viewerId, 'VIEWER'],
    )
    await pool.query(
      'INSERT INTO board_columns (board_id,name,position) VALUES ($1,$2,0),($1,$3,1)',
      [board.rows[0].id, 'To Do', 'In Progress'],
    )

    const created = await createPostgresTask({
      pool, userId: ownerLegacy, role: 'PROJECT_MANAGER', projectId: projectLegacy,
      payload: { title: 'Integration task', description: 'created by SQL service', priority: 'HIGH' },
    })
    assert(created.title === 'Integration task' && created.status === 'TODO', 'Task create response was incorrect')
    assert(created.version === 1, 'New task should start at version 1')

    const dependent = await createPostgresTask({
      pool, userId: ownerLegacy, role: 'PROJECT_MANAGER', projectId: projectLegacy,
      payload: { title: 'Dependent integration task', priority: 'HIGH' },
    })
    await pool.query(
      'INSERT INTO task_dependencies (project_id, predecessor_task_id, successor_task_id, created_by) VALUES ($1,$2,$3,$4)',
      [projectId, created.id, dependent.id, ownerId],
    )

    const label = await pool.query(
      'INSERT INTO labels (board_id,name) VALUES ($1,$2) RETURNING id',
      [board.rows[0].id, 'Regression'],
    )
    await pool.query('INSERT INTO task_labels (task_id,label_id) VALUES ($1,$2)', [created.id, label.rows[0].id])
    await pool.query('UPDATE tasks SET due_date=$1 WHERE id=$2', ['2027-01-15T12:00:00.000Z', created.id])

    const listed = await listPostgresTasks({ pool, userId: ownerLegacy, role: 'PROJECT_MANAGER', projectId: projectLegacy, query: { status: 'TODO', priority: 'HIGH', page: 1, limit: 10 } })
    assert(listed.tasks.some((task) => task.title === 'Integration task'), 'Created task was not returned by list')
    assert(listed.pagination.total >= 2, 'List pagination total should include both tasks')
    const listedPredecessor = listed.tasks.find((task) => task.id === created.id)
    const listedDependent = listed.tasks.find((task) => task.id === dependent.id)
    assert(listedPredecessor?.blockingCount === 1 && listedPredecessor?.blockingTaskIds.includes(dependent.id), 'Predecessor should include blocking dependency metadata')
    assert(listedDependent?.blockedByCount === 1 && listedDependent?.blockedByTaskIds.includes(created.id) && listedDependent.hasBlockingDependencies, 'Dependent should include blocked-by metadata')

    const labelAndDateFiltered = await listPostgresTasks({
      pool, userId: ownerLegacy, role: 'PROJECT_MANAGER', projectId: projectLegacy,
      query: { label: 'Regression', dueDateFrom: '2027-01-01T00:00:00.000Z', dueDateTo: '2027-02-01T00:00:00.000Z' },
    })
    assert(labelAndDateFiltered.tasks.some((task) => task.id === created.id), 'Label and due-date-range filters should include matching task')
    const overdueOverridesDateRange = await listPostgresTasks({
      pool, userId: ownerLegacy, role: 'PROJECT_MANAGER', projectId: projectLegacy,
      query: { overdue: 'true', dueDateFrom: '2027-01-01T00:00:00.000Z', dueDateTo: '2027-02-01T00:00:00.000Z' },
    })
    assert(!overdueOverridesDateRange.tasks.some((task) => task.id === created.id), 'overdue=true should take precedence over date range filters')
    const excludedByLabel = await listPostgresTasks({
      pool, userId: ownerLegacy, role: 'PROJECT_MANAGER', projectId: projectLegacy,
      query: { label: 'missing-label' },
    })
    assert(!excludedByLabel.tasks.some((task) => task.id === created.id), 'Label filter should exclude non-matching tasks')
    await expectStatus(
      () => listPostgresTasks({ pool, userId: ownerLegacy, role: 'PROJECT_MANAGER', projectId: projectLegacy, query: { dueDateFrom: 'not-a-date' } }),
      400, 'invalid dueDateFrom filter',
    )
    await expectStatus(
      () => listPostgresTasks({ pool, userId: ownerLegacy, role: 'PROJECT_MANAGER', projectId: projectLegacy, query: { dueDateFrom: '2027-02-01', dueDateTo: '2027-01-01' } }),
      400, 'reversed due-date range',
    )

    const updated = await updatePostgresTask({
      pool, userId: ownerLegacy, role: 'PROJECT_MANAGER', taskId: created._id,
      payload: { title: 'Updated integration task', status: 'IN_PROGRESS', version: 1 },
    })
    assert(updated.title === 'Updated integration task' && updated.status === 'IN_PROGRESS', 'Task update response was incorrect')
    assert(updated.version === 2, 'Task version should increment after update')

    await expectStatus(
      () => updatePostgresTask({ pool, userId: ownerLegacy, role: 'PROJECT_MANAGER', taskId: created._id, payload: { title: 'Stale update', version: 1 } }),
      409, 'stale version update',
    )
    await expectStatus(
      () => listPostgresTasks({ pool, userId: outsiderLegacy, role: 'TEAM_MEMBER', projectId: projectLegacy, query: {} }),
      403, 'non-member project read',
    )
    await expectStatus(
      () => createPostgresTask({ pool, userId: outsiderLegacy, role: 'TEAM_MEMBER', projectId: projectLegacy, payload: { title: 'Unauthorized task' } }),
      403, 'non-member project task creation',
    )
    await expectStatus(
      () => createPostgresTask({ pool, userId: viewerLegacy, role: 'TEAM_MEMBER', projectId: projectLegacy, payload: { title: 'Viewer write attempt' } }),
      403, 'viewer task creation',
    )
    await expectStatus(
      () => updatePostgresTask({ pool, userId: viewerLegacy, role: 'TEAM_MEMBER', taskId: created._id, payload: { title: 'Viewer update attempt' } }),
      403, 'viewer task update',
    )
    await expectStatus(
      () => listPostgresTasks({ pool, userId: ownerLegacy, role: 'PROJECT_MANAGER', projectId: 'not-an-object-id', query: {} }),
      400, 'invalid project ID',
    )
    await expectStatus(
      () => updatePostgresTask({ pool, userId: ownerLegacy, role: 'PROJECT_MANAGER', taskId: 'not-a-task-id', payload: { title: 'Invalid ID update' } }),
      400, 'invalid task ID',
    )
    await expectStatus(
      () => updatePostgresTask({ pool, userId: ownerLegacy, role: 'PROJECT_MANAGER', taskId: '0123456789abcdef01234567', payload: { title: 'Missing task update' } }),
      404, 'missing task mapping',
    )
    const adminList = await listPostgresTasks({ pool, userId: outsiderLegacy, role: 'ADMINISTRATOR', projectId: projectLegacy, query: {} })
    assert(adminList.tasks.length >= 1, 'administrator should be able to read a migrated project')
    console.log('PostgreSQL task integration tests passed: create, list/filter/pagination, update, stale version conflict, non-member denial, viewer read-only, invalid IDs, and administrator access.')
  } finally {
    if (projectId) await pool.query('DELETE FROM projects WHERE id=$1', [projectId])
    if (ownerId) await pool.query('DELETE FROM users WHERE id=$1', [ownerId])
    if (outsiderId) await pool.query('DELETE FROM users WHERE id=$1', [outsiderId])
    if (viewerId) await pool.query('DELETE FROM users WHERE id=$1', [viewerId])
    await closePostgresPool()
  }
}

main().catch(async (error) => {
  console.error(error.stack || error.message)
  await closePostgresPool().catch(() => {})
  process.exitCode = 1
})
