import 'dotenv/config'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPostgresPool, closePostgresPool } from '../db/postgres.js'

const here = dirname(fileURLToPath(import.meta.url))
const migrationDirectory = join(here, '../../database/migrations')

async function migrate() {
  const pool = getPostgresPool()
  const client = await pool.connect()

  try {
    await client.query('SELECT pg_advisory_lock($1)', [72419026])
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)

    const files = (await readdir(migrationDirectory))
      .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
      .sort()

    for (const name of files) {
      const alreadyApplied = await client.query(
        'SELECT 1 FROM schema_migrations WHERE name = $1',
        [name],
      )
      if (alreadyApplied.rowCount) {
        console.log(`Skipping applied migration: ${name}`)
        continue
      }

      const sql = await readFile(join(migrationDirectory, name), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name])
        await client.query('COMMIT')
        console.log(`Applied migration: ${name}`)
      } catch (error) {
        await client.query('ROLLBACK')
        throw new Error(`Migration ${name} failed: ${error.message}`, { cause: error })
      }
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [72419026])
    } finally {
      client.release()
      await closePostgresPool()
    }
  }
}

migrate().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
