# Operator checklist: validating PostgreSQL migration safely

> **Scope note:** This document describes a future production-cutover/migration exercise. For the current Kendram development/testing task, use the already-designated `Kendram_db` database to validate PostgreSQL-backed features. Do **not** run MongoDB user/entity import commands or migration preflight as routine next steps. Do not seed or import records. Keep `kendram_pg_dev_test` separate. A production cutover or data migration requires a separate explicit decision.


This checklist is for the repository owner. It intentionally does not enable PostgreSQL in production or perform a live import from CI.

## 1. CI status

Check the latest workflow on the branch `feat/postgres-persistence`:
https://github.com/SwarnjeetYadav/junior-software-developer-intern/actions

Do not proceed if any backend, frontend, container, integration, or migration-preflight step is red. CI success proves code checks passed in the CI environment; it does not prove that your own MongoDB records have been migrated.

## 2. Create a separate staging PostgreSQL database

Use a managed PostgreSQL provider or a separate local PostgreSQL instance. Create a new empty database exclusively for migration testing. Do not point this at the production database. Take a backup of any target that already contains data.

You also need a MongoDB connection string for a staging copy/snapshot of the source data. Prefer a sanitized staging clone over production credentials. The scripts do not require sharing connection strings with ChatGPT or committing them to Git.

## 3. Configure environment variables locally (Windows PowerShell)

Open a terminal in the repository's `backend` folder. In that terminal only, set the source and target connection strings from your provider dashboard:

```powershell
$env:MONGODB_URI = Read-Host "Paste the MongoDB staging URI"
$env:DATABASE_URL = Read-Host "Paste the PostgreSQL staging URI"
$env:JWT_SECRET = "local-test-secret-change-this-before-running-the-app"
```

Do not paste the values into a chat, issue, pull request, source file, or screenshot. For the application integration tests, use a private test database and a strong random JWT secret.

## 4. Apply schema migrations to the staging target

```powershell
npm ci
npm run db:migrate:postgres
```

Verify the database name/host shown in your provider dashboard before running the command. It creates/updates schema objects on the PostgreSQL target; it does not import MongoDB business records.

## 5. Dry-run the user migration first

```powershell
npm run db:migrate:postgres:users
```

Review the JSON output locally. Stop if `blockers` is non-empty or if the number of planned inserts is unexpected. Do not send output containing private data if you extend it later; current reports are designed not to include emails or password hashes.

## 6. Apply user migration only to staging

After a backup and a reviewed clean dry-run, confirm independently that `DATABASE_URL` points to the staging database, then run:

```powershell
$env:POSTGRES_IMPORT_TARGET = "staging"
$env:POSTGRES_IMPORT_CONFIRM = "true"
npm run db:migrate:postgres:users -- --apply
```

Run the dry-run command again. It should report the accounts as already mapped and have zero planned inserts. If not, stop and investigate. This tests idempotency for user accounts only.

The staging marker and confirmation flag are safety guardrails, not automatic proof that the connection is staging.

## 7. Do not enable production feature flags yet

Keep all of these disabled in your local/deployment environment until a full entity importer, reconciliation, route parity, and rollback rehearsal have been completed:

- `POSTGRES_AUTH_ENABLED=false`
- `POSTGRES_PROJECTS_ENABLED=false`
- `POSTGRES_TASKS_ENABLED=false`
- `VITE_POSTGRES_API_ENABLED=false`

The first three are backend environment variables; the last is a frontend build-time environment variable. Do not change them in Vercel/Render production settings during this validation stage.

## 8. Current blockers that require actual database validation

The current importer migrates user accounts only. It is not yet the full MongoDB-to-PostgreSQL data importer. A complete cutover still needs a reviewed, repeatable importer and reconciliation for projects, memberships, boards/columns, tasks, labels/task-label joins, comments, dependencies, invitations, chat, notifications, and activity data; tests for authorization and Socket.IO realtime; frontend smoke tests; and a backup/restore and rollback rehearsal.

Do not mark cutover ready merely because CI passes or the user import succeeds. No production database should be modified until these steps are complete and explicitly approved.
