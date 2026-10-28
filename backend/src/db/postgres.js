import pg from 'pg'

const { Pool } = pg

let pool

export function isPostgresConfigured(env = process.env) {
  return Boolean(env.DATABASE_URL?.trim())
}

export function getPostgresPool(env = process.env) {
  if (!isPostgresConfigured(env)) {
    throw new Error('DATABASE_URL is required to use PostgreSQL persistence')
  }

  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: Number(env.PG_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: env.PG_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
    })
    pool.on('error', (error) => {
      console.error('Unexpected PostgreSQL pool error', error.message)
    })
  }

  return pool
}

export async function checkPostgresConnection(env = process.env) {
  const client = await getPostgresPool(env).connect()
  try {
    const result = await client.query('SELECT 1 AS ok')
    return result.rows[0]?.ok === 1
  } finally {
    client.release()
  }
}

export async function closePostgresPool() {
  if (!pool) return
  const current = pool
  pool = undefined
  await current.end()
}
