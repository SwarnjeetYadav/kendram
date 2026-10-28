import 'dotenv/config'
import mongoose from 'mongoose'
import User from '../models/User.js'
import { getPostgresPool, closePostgresPool } from '../db/postgres.js'

const apply = process.argv.includes('--apply')
const mongoUri = process.env.MONGODB_URI?.trim()
const databaseUrl = process.env.DATABASE_URL?.trim()

if (!mongoUri || !databaseUrl) {
  console.error('Configuration error: MONGODB_URI and DATABASE_URL are required.')
  process.exit(2)
}
if (apply) {
  const targetDatabase = (() => {
    try { return decodeURIComponent(new URL(databaseUrl).pathname.slice(1)) } catch { return '' }
  })()
  const confirmedDatabase = process.env.POSTGRES_IMPORT_DATABASE?.trim()
  const safeName = /(?:^|[_-])(dev|test|staging)(?:$|[_-])/i.test(targetDatabase)
  const forbiddenName = /prod(?:uction)?|live/i.test(targetDatabase)
  if (process.env.POSTGRES_IMPORT_CONFIRM !== 'true'
    || process.env.POSTGRES_IMPORT_TARGET !== 'staging'
    || !confirmedDatabase
    || confirmedDatabase !== targetDatabase
    || !safeName
    || forbiddenName) {
    console.error('Refusing to write. Confirm a non-production database explicitly: set POSTGRES_IMPORT_CONFIRM=true, POSTGRES_IMPORT_TARGET=staging, and POSTGRES_IMPORT_DATABASE to the exact database name in DATABASE_URL (which must be clearly named dev/test/staging), then pass --apply.')
    process.exit(2)
  }
}

const normalize = value => String(value || '').trim().toLowerCase()
const validRoles = new Set(['ADMINISTRATOR', 'PROJECT_MANAGER', 'TEAM_MEMBER'])
const validStatuses = new Set(['ACTIVE', 'INACTIVE'])

async function main() {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 })
  const pool = getPostgresPool()
  try {
    const migration = await pool.query("SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ready")
    if (!migration.rows[0].ready) throw new Error('PostgreSQL schema is not migrated; run npm run db:migrate:postgres against staging first.')

    // Explicitly select the legacy hash; Mongo's model hides it by default.
    const users = await User.find({}).select('+passwordHash').lean()
    const sqlUsers = await pool.query('SELECT id,email,legacy_mongo_id FROM users')
    const byLegacyId = new Map(sqlUsers.rows.filter(row => row.legacy_mongo_id).map(row => [String(row.legacy_mongo_id), row]))
    const byEmail = new Map(sqlUsers.rows.map(row => [normalize(row.email), row]))
    const planned = []
    const skipped = []
    const blockers = []
    const seenLegacy = new Set()
    const seenEmail = new Set()

    for (const user of users) {
      const legacyId = String(user._id)
      const email = normalize(user.email)
      if (!/^[a-f\d]{24}$/i.test(legacyId)) {
        blockers.push({ type: 'invalid_source_id', legacyId: null })
        continue
      }
      if (!email || !user.passwordHash || !validRoles.has(user.role || 'TEAM_MEMBER') || !validStatuses.has(user.status || 'ACTIVE')) {
        blockers.push({ type: 'invalid_required_user_fields', legacyId })
        continue
      }
      if (seenLegacy.has(legacyId) || seenEmail.has(email)) {
        blockers.push({ type: 'duplicate_source_identity', legacyId })
        continue
      }
      seenLegacy.add(legacyId)
      seenEmail.add(email)

      const mapped = byLegacyId.get(legacyId)
      const emailOwner = byEmail.get(email)
      if (mapped) {
        if (normalize(mapped.email) !== email) blockers.push({ type: 'mapped_id_email_mismatch', legacyId })
        else skipped.push({ legacyId, reason: 'already_mapped' })
        continue
      }
      if (emailOwner) {
        blockers.push({ type: 'email_conflict_with_existing_sql_account', legacyId })
        continue
      }
      planned.push({
        legacyId, name: String(user.name || '').trim(), email,
        passwordHash: user.passwordHash,
        emailVerified: user.emailVerified !== false,
        role: validRoles.has(user.role) ? user.role : 'TEAM_MEMBER',
        status: validStatuses.has(user.status) ? user.status : 'ACTIVE',
        displayName: user.displayName || '', avatarUrl: user.avatarUrl || '',
        bio: user.bio || '', location: user.location || '',
        timezone: user.timezone || 'Asia/Kolkata',
        preferences: user.preferences || {
          notifications: { taskAssignment: true, projectInvitation: true, chatMention: true, dependencyUnblocked: true, teamUpdates: true },
          display: { compactMode: false },
        },
        createdAt: user.createdAt || new Date(),
        updatedAt: user.updatedAt || new Date(),
      })
    }

    const report = {
      reportType: 'postgres-user-migration',
      mode: apply ? 'APPLY_STAGING' : 'DRY_RUN',
      source: 'MongoDB users',
      target: 'PostgreSQL users',
      sourceUsers: users.length,
      alreadyMappedAndSkipped: skipped.length,
      plannedInserts: planned.length,
      blockers,
      writesPerformed: false,
      note: 'This command migrates user accounts only. Run the entity importer separately after user mappings are verified. Neither importer authorizes production cutover; backup/restore, rollback, API parity, and staging acceptance remain separate gates.',
    }

    if (blockers.length) {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n')
      process.exitCode = 1
      return
    }

    if (!apply) {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n')
      return
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      // Recheck uniqueness in the write transaction to avoid a stale preflight.
      for (const user of planned) {
        const conflict = await client.query(
          'SELECT id FROM users WHERE email=$1 OR legacy_mongo_id=$2 FOR UPDATE',
          [user.email, user.legacyId],
        )
        if (conflict.rowCount) throw new Error('Target changed after preflight; refusing partial import. Re-run dry-run and reconcile conflicts.')
        await client.query(
          `INSERT INTO users
            (name,email,password_hash,email_verified,role,status,legacy_mongo_id,
             display_name,avatar_url,bio,location,timezone,preferences,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)`,
          [user.name, user.email, user.passwordHash, user.emailVerified, user.role, user.status,
            user.legacyId, user.displayName, user.avatarUrl, user.bio, user.location, user.timezone,
            JSON.stringify(user.preferences), user.createdAt, user.updatedAt],
        )
      }
      await client.query('COMMIT')
      report.writesPerformed = true
      report.inserted = planned.length
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  } finally {
    await closePostgresPool()
    await mongoose.disconnect()
  }
}

main().catch(async error => {
  console.error('PostgreSQL user migration failed:', error.message)
  await closePostgresPool().catch(() => {})
  await mongoose.disconnect().catch(() => {})
  process.exitCode = 2
})
