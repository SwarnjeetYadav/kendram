import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { getPostgresPool, closePostgresPool } from '../db/postgres.js'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

let savepointCounter = 0

async function expectQueryFailure(client, work, message) {
  const savepoint = `expected_failure_${++savepointCounter}`
  await client.query(`SAVEPOINT ${savepoint}`)
  let failed = false
  try {
    await work()
  } catch {
    failed = true
  }
  if (failed) await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
  await client.query(`RELEASE SAVEPOINT ${savepoint}`)
  assert(failed, message)
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must point to a disposable PostgreSQL test database')
  }

  const migration = spawnSync(process.execPath, ['src/scripts/migratePostgres.js'], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
  })
  if (migration.status !== 0) {
    throw new Error(`Migration runner failed:\n${migration.stdout}\n${migration.stderr}`)
  }
  process.stdout.write(migration.stdout)

  const pool = getPostgresPool()
  const client = await pool.connect()
  const parity = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY($1::text[])
  `, [[
    'project_members', 'invitations', 'notifications', 'project_messages', 'activity_logs',
  ]])
  const parityTables = new Set(parity.rows.map((row) => row.table_name))
  for (const table of ['project_members', 'invitations', 'notifications', 'project_messages', 'activity_logs']) {
    assert(parityTables.has(table), `Schema parity migration did not create ${table}`)
  }
  const parityColumns = await pool.query(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (table_name = 'users' AND column_name = ANY($1::text[])
        OR table_name = 'tasks' AND column_name = ANY($2::text[]))
  `, [
    ['display_name', 'avatar_url', 'bio', 'location', 'timezone', 'preferences',
      'email_verification_token_hash', 'email_verification_expires_at',
      'password_reset_token_hash', 'password_reset_expires_at'],
    ['estimate_minutes', 'started_at', 'completed_at'],
  ])
  const parityColumnKeys = new Set(parityColumns.rows.map((row) => `${row.table_name}.${row.column_name}`))
  for (const column of [
    'users.display_name', 'users.avatar_url', 'users.bio', 'users.location', 'users.timezone',
    'users.preferences', 'users.email_verification_token_hash', 'users.email_verification_expires_at',
    'users.password_reset_token_hash', 'users.password_reset_expires_at',
    'tasks.estimate_minutes', 'tasks.started_at', 'tasks.completed_at',
  ]) {
    assert(parityColumnKeys.has(column), `Schema parity migration did not create ${column}`)
  }
  const legacyBridgeColumns = await pool.query(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ANY($1::text[])
      AND column_name = 'legacy_mongo_id'
  `, [['project_members', 'invitations', 'notifications', 'project_messages', 'activity_logs']])
  const legacyBridgeTables = new Set(legacyBridgeColumns.rows.map((row) => row.table_name))
  for (const table of ['project_members', 'invitations', 'notifications', 'project_messages', 'activity_logs']) {
    assert(legacyBridgeTables.has(table), `Legacy ID bridge migration did not create ${table}.legacy_mongo_id`)
  }

  const suffix = randomUUID()
  let userId
  try {
    await client.query('BEGIN')
    const user = await client.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
      ['PostgreSQL Schema Test', `pg-test-${suffix}@example.test`, 'test-only-hash'],
    )
    userId = user.rows[0].id

    await expectQueryFailure(client,
      () => client.query(
        'INSERT INTO projects (name, owner_id) VALUES ($1, $2)',
        ['Invalid owner project', randomUUID()],
      ),
      'Foreign-key constraint did not reject a project with a missing owner',
    )
    await expectQueryFailure(client,
      () => client.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)',
        ['Duplicate email', `pg-test-${suffix}@example.test`, 'test-only-hash'],
      ),
      'Unique email constraint did not reject a duplicate email',
    )
    await expectQueryFailure(client,
      () => client.query(
        'INSERT INTO projects (name, owner_id, status) VALUES ($1, $2, $3)',
        ['Invalid status project', userId, 'NOT_A_STATUS'],
      ),
      'Project status check constraint did not reject an invalid status',
    )

    const project = await client.query(
      'INSERT INTO projects (name, owner_id, status) VALUES ($1, $2, $3) RETURNING id',
      ['Schema test project', userId, 'ACTIVE'],
    )
    const board = await client.query(
      'INSERT INTO boards (project_id, name, created_by) VALUES ($1, $2, $3) RETURNING id',
      [project.rows[0].id, 'Schema test board', userId],
    )
    const column = await client.query(
      'INSERT INTO board_columns (board_id, name, position) VALUES ($1, $2, $3) RETURNING id',
      [board.rows[0].id, 'To Do', 0],
    )
    const task = await client.query(
      'INSERT INTO tasks (board_id, column_id, title, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
      [board.rows[0].id, column.rows[0].id, 'Schema smoke test task', userId],
    )
    assert(Boolean(task.rows[0]?.id), 'Task insert did not return an id')

    await expectQueryFailure(client,
      () => client.query(
        'INSERT INTO board_columns (board_id, name, position) VALUES ($1, $2, $3)',
        [board.rows[0].id, 'Duplicate position', 0],
      ),
      'Unique board-column position constraint did not reject a duplicate position',
    )

    await client.query('ROLLBACK')
    console.log('PostgreSQL schema tests passed: migrations, application schema parity, foreign keys, unique constraints, check constraints, and core relational inserts.')
  } catch (error) {
    try { await client.query('ROLLBACK') } catch {}
    throw error
  } finally {
    client.release()
    await closePostgresPool()
  }
}

main().catch(async (error) => {
  console.error(error.message)
  await closePostgresPool().catch(() => {})
  process.exitCode = 1
})
