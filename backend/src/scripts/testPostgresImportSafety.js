import { spawnSync } from 'node:child_process'

const scripts = [
  'src/scripts/migratePostgresUsers.js',
  'src/scripts/migratePostgresEntities.js',
]
const baseEnv = {
  ...process.env,
  MONGODB_URI: 'mongodb://127.0.0.1:27017/kendram_guard_test',
  DATABASE_URL: 'postgres://test:test@127.0.0.1:5432/kendram_pg_dev_test',
  POSTGRES_IMPORT_CONFIRM: 'true',
  POSTGRES_IMPORT_TARGET: 'staging',
  POSTGRES_IMPORT_DATABASE: 'kendram_pg_dev_test',
}

function assertRefused(script, scenario, overrides) {
  const result = spawnSync(process.execPath, [script, '--apply'], {
    cwd: process.cwd(),
    env: { ...baseEnv, ...overrides },
    encoding: 'utf8',
    timeout: 10000,
  })
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  if (result.status !== 2 || !output.includes('Refusing to write')) {
    throw new Error(
      `Import safety test failed for ${script} (${scenario}). Expected guard refusal before any DB connection. Exit: ${result.status}; output: ${output.slice(0, 500)}`,
    )
  }
}

for (const script of scripts) {
  assertRefused(script, 'missing explicit confirmation', { POSTGRES_IMPORT_CONFIRM: 'false' })
  assertRefused(script, 'database-name mismatch', { POSTGRES_IMPORT_DATABASE: 'different_database' })
  assertRefused(script, 'production-like database name', {
    DATABASE_URL: 'postgres://test:test@127.0.0.1:5432/kendram_prod',
    POSTGRES_IMPORT_DATABASE: 'kendram_prod',
  })
}

console.log('PostgreSQL import safety tests passed: both importers reject missing confirmation, mismatched database names, and production-like targets before connecting.')
