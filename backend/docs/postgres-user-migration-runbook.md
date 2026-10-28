# MongoDB user-account migration to PostgreSQL

## Scope and safety

`npm run db:migrate:postgres:users` inventories MongoDB user accounts and PostgreSQL user rows. It is **dry-run by default** and emits a JSON summary without password hashes, reset tokens, email addresses, or connection strings. It migrates user accounts only; run the separate entity importer after the user mapping is verified. Neither importer authorizes cutover.

The importer preserves bcrypt-compatible password hashes, the MongoDB 24-character ID in `legacy_mongo_id`, account role/status, email-verification state, profile fields, preferences, and timestamps. Existing rows with the same legacy ID are skipped. An email collision with a different SQL account, invalid required source data, or duplicate source identity blocks the entire import. The script never overwrites existing SQL accounts.

## Dry run

Configure `MONGODB_URI` for the source and `DATABASE_URL` for a **dedicated staging PostgreSQL database** with migrations applied, then run from `backend/`:

```bash
npm run db:migrate:postgres:users
```

Review `plannedInserts`, `alreadyMappedAndSkipped`, and `blockers`. Resolve every blocker and run dry-run again before any write.

## Explicit staging import

Only after a verified backup, review, and a clean dry run, apply mode requires all of the following controls: `POSTGRES_IMPORT_CONFIRM=true`, `POSTGRES_IMPORT_TARGET=staging`, and `POSTGRES_IMPORT_DATABASE` exactly matching the database name parsed from `DATABASE_URL`. The database name must include a standalone `dev`, `test`, or `staging` segment and must not contain production/live naming. For PowerShell, set these values in the current terminal before running:

```powershell
$env:POSTGRES_IMPORT_TARGET = 'staging'
$env:POSTGRES_IMPORT_CONFIRM = 'true'
$env:POSTGRES_IMPORT_DATABASE = 'kendram_pg_dev_test' # must exactly match DATABASE_URL
npm run db:migrate:postgres:users -- --apply
```

Replace the example database name only after independently confirming the actual target. These checks are conservative guardrails, not automatic proof that the connection is staging. The script runs all inserts in one transaction, rechecks target conflicts, and rolls back on any error. Never copy the example values blindly.

## Cutover limitations

A successful user import is not a full migration or cutover approval. Existing MongoDB users can keep the same password because bcrypt hashes are copied without plaintext passwords, but their SQL profile/preferences may become a point-in-time snapshot. Plan a final write freeze or reconciliation window to account for changes made after the import.

The rest of the application data still requires an entity-by-entity migration in foreign-key order and verified counts/relationships. Keep `POSTGRES_AUTH_ENABLED`, `POSTGRES_PROJECTS_ENABLED`, `POSTGRES_TASKS_ENABLED`, and `VITE_POSTGRES_API_ENABLED` disabled until data migration, route parity, authorization, rollback, backup/restore, and end-to-end checks are complete. MongoDB configuration must remain while any route or background process still uses it.
