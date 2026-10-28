# PostgreSQL Staging Operations Runbook

Status: operational checklist; not a production cutover approval.

## Current safety boundary

- Production remains the existing Render `anvaya-api` service on `main` using MongoDB.
- Staging database: Render PostgreSQL `Kendram_db`, database name `kendram_staging`.
- Do not set PostgreSQL feature flags on the production service.
- Do not merge the persistence PR or point the frontend at PostgreSQL until every acceptance and recovery gate below is signed off.
- The Render Free database expires on 2026-11-27 and does not provide managed backups/PITR. It is a temporary staging target, not a durable production database.

## 1. Create a separate Render staging API

Create a new Render Web Service (do not edit `anvaya-api`):

- Repository: `https://github.com/SwarnjeetYadav/junior-software-developer-intern`
- Branch: `feat/postgres-persistence`
- Root directory: `backend/`
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/api/v1/health`
- Region: Oregon (same region as the staging database)
- Auto-deploy: enabled after the first successful configuration/deploy.

Configure secrets directly in the Render dashboard; never commit them or paste them into chat:

- `MONGODB_URI`: existing staging/test MongoDB URI (required by current startup configuration; keep Mongo available for routes not yet migrated)
- `JWT_SECRET`: staging-only secret, at least 32 characters
- `CLIENT_ORIGINS`: exact staging frontend origin(s), comma-separated
- `DATABASE_URL`: Internal Database URL copied from the `Kendram_db` database's Render dashboard
- `PG_SSL=true`
- `PG_POOL_MAX=5`
- `NODE_ENV=production`

Keep these PostgreSQL routing flags explicitly disabled for the first deployment:
`POSTGRES_AUTH_ENABLED=false`, `POSTGRES_PROJECTS_ENABLED=false`, `POSTGRES_TASKS_ENABLED=false`.
Keep any other `POSTGRES_*_ENABLED` routing flags false until the specific route has passed acceptance. Keep the frontend's `VITE_POSTGRES_API_ENABLED=false`.

Confirm the service health check succeeds before enabling any feature flag. Do not copy a production JWT secret to staging.

## 2. Logical backup and restore rehearsal (PowerShell)

Install PostgreSQL client tools compatible with PostgreSQL 18, then run this from a trusted machine. Obtain the Internal Database URL from Render and set it in the current PowerShell session without printing it:

```powershell
$env:DATABASE_URL = Read-Host "Paste staging Internal Database URL"
$env:PGSSLMODE = "verify-full"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupFile = Join-Path $PWD "kendram-staging-$stamp.dump"

pg_dump --format=custom --no-owner --no-privileges --file="$backupFile" "$env:DATABASE_URL"
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed; do not continue" }
if (!(Test-Path $backupFile) -or (Get-Item $backupFile).Length -lt 1024) { throw "Backup file missing or unexpectedly small" }
pg_restore --list "$backupFile" | Select-Object -First 20
if ($LASTEXITCODE -ne 0) { throw "Backup archive validation failed" }
Get-FileHash "$backupFile" -Algorithm SHA256
```

Store the dump and hash in a private, access-controlled location. Do not commit the dump to Git.

For the restore rehearsal, create a **separate, empty PostgreSQL database** in the Render dashboard (or use a separate local PostgreSQL 18 instance). Never restore into `kendram_staging` or production. Copy the restore target's connection URL and run:

```powershell
$env:RESTORE_DATABASE_URL = Read-Host "Paste URL for the separate EMPTY restore target"
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$env:RESTORE_DATABASE_URL" "$backupFile"
if ($LASTEXITCODE -ne 0) { throw "Restore failed; investigate before relying on this backup" }
psql "$env:RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT current_database(), current_setting('server_version');"
psql "$env:RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;"
```

Compare key table counts in the restored database against the source backup using read-only queries. Confirm expected rows exist in users, projects, project_members, tasks, comments, project_messages, activity_logs, and notifications. Record the dump path, SHA-256, restore target, timestamp, counts, and any errors. A successful dump alone is not a restore rehearsal.

## 3. Staging acceptance checklist

Use only staging accounts and staging data. Record pass/fail and relevant request IDs (never tokens or passwords):

- [ ] `GET /api/v1/health` responds healthy.
- [ ] Login/logout; invalid credentials and expired/invalid token errors are safe.
- [ ] Project listing and details respect membership; a non-member cannot read or mutate another project's data.
- [ ] Owner/admin/member/viewer permissions are consistent for create/update/delete actions.
- [ ] Task create, read, update, delete, assignment, and invalid IDs behave correctly.
- [ ] Comments create/list and author/project relationships are correct.
- [ ] Chat message send/list works and unauthorized project messages are blocked.
- [ ] Notifications list/read and user isolation work.
- [ ] Validation failures return appropriate 4xx responses; unexpected failures return safe 5xx responses without stack traces/secrets.
- [ ] Restart/redeploy does not lose persisted PostgreSQL records.
- [ ] Review service logs for connection, migration, auth, and unhandled errors.
- [ ] Run the existing backend integration and PostgreSQL tests on the exact commit under review; do not treat CI alone as staging acceptance.

Only enable one route-family flag at a time, then repeat that family's acceptance tests. Keep the flag off if any check fails.

## 4. Rollback procedure

Until production cutover is formally approved, rollback means leaving production on the current MongoDB-backed `main` service:

1. Do not change production `anvaya-api` environment variables or branch.
2. If staging acceptance fails, disable the relevant PostgreSQL feature flag on the staging API and redeploy/restart it.
3. Keep `VITE_POSTGRES_API_ENABLED=false` so the production frontend remains on the current API behavior.
4. Preserve staging logs and the backup for diagnosis; do not delete MongoDB data as part of rollback.
5. Re-run health and smoke checks on the existing production URL `https://anvaya-api-m4pu.onrender.com/api/v1/health`.
6. Document the failure, fix it on the migration branch, and repeat only the affected acceptance area.

For a future production cutover, separately approve a write-freeze/replication plan, final source-to-target count and relationship reconciliation, a tested restore, a maintenance window, and an explicit rollback owner/time window. A one-time import is not continuous replication; MongoDB writes made after the import are not automatically present in PostgreSQL.

## Exit criteria

The migration is **not production-ready** until the separate staging API is healthy, every applicable acceptance item passes, the backup has been restored successfully into a separate empty database, data counts and relationships are reconciled, and rollback has been rehearsed. The importer reporting `readyForImport: true` only establishes import/preflight readiness.
