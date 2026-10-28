# PostgreSQL migration preflight and reconciliation runbook

## Status and safety boundary

This is the preflight plan for the migration branch. MongoDB remains the production source of truth. The existing Mongo-backed API remains enabled, and `POSTGRES_TASKS_ENABLED` must remain unset or `false` in production. Do not run a write-capable import against production as part of preflight.

## Running the read-only preflight

From the `backend` directory, configure `MONGODB_URI` and `DATABASE_URL` for a read-only source and a designated staging PostgreSQL target, then run:

```bash
npm run db:preflight:postgres
```

The command prints a JSON report to stdout. It is a read-only reconciliation check, primarily for after an import or for measuring how much mapping work remains; because it requires source records to have target legacy-ID mappings, `readyForImport: false` is expected before the records have been imported. Use each importer's own dry-run for its pre-write planning. To also save a new report file without overwriting an existing file:

```bash
node src/scripts/preflightPostgresMigration.js ./migration-preflight-report.json
```

The script uses MongoDB reads and PostgreSQL `SELECT` statements only. It does not apply migrations, import records, modify either database, or change the runtime feature flag. Exit codes are 0 for a clean report, 1 for reconciliation blockers/warnings, and 2 for configuration or execution failure. Use staging credentials; never paste connection strings into issue comments or reports.

## Phase 0 — Read-only inventory

Before importing anything, record a timestamped snapshot of source and target counts. Inventory at least:

- Users, projects, project memberships
- Boards and board columns
- Tasks, labels and task-label associations
- Comments, activity history and task dependencies

For each source entity, record total count, active/inactive or status breakdown where relevant, and number of documents with missing/invalid required references. For PostgreSQL, record total rows, rows with non-null `legacy_mongo_id`, duplicate legacy IDs (expected zero), and unmapped rows.

Do not treat a matching count as proof of correctness. Count comparisons must be supplemented by per-record mapping and foreign-key checks.

## Phase 1 — Mapping coverage

Validate these source-to-target references using legacy IDs:

1. Every project owner resolves to exactly one SQL user.
2. Every membership resolves to one SQL project and one SQL user; no duplicate membership pair exists.
3. Every task resolves to one SQL project/board, one valid board column, one creator, and either a valid assignee or an explicitly reported null/missing assignee.
4. Every task dependency resolves to one project, predecessor task, successor task and creator; predecessor and successor differ; duplicate edges are absent.
5. Every comment resolves to one task and one author.
6. Every label association resolves to one board label and one task.
7. Every activity record resolves to its actor and project; nullable task references are reported separately.

The SQL schema represents task status through board columns. Define and validate a deterministic mapping for TODO, IN_PROGRESS, REVIEW, BLOCKED and COMPLETED. Unknown values must be reported as blockers, not silently coerced.

## Phase 2 — Reconciliation report

The preflight report should be machine-readable JSON and a human-readable summary. Include:

- Run ID and UTC timestamp
- Source and destination counts by entity
- Legacy ID mapping coverage and duplicate IDs
- Missing owner, membership, board, column, creator, assignee, dependency, comment and label references
- Unknown statuses and unsupported fields
- Count deltas and a sample of mismatched IDs (with a configurable cap)
- Explicit `blockers`, `warnings`, and `readyForImport` boolean

Exit code contract:
- `0`: no blockers found; this only means the preflight is clean, not that cutover is approved.
- `1`: blockers or warnings require reconciliation.
- `2`: configuration, connection or unexpected execution error.

Never include password hashes, tokens, connection strings, private comment bodies or other sensitive field values in reports. Legacy IDs and entity types are sufficient to investigate most mapping errors.

## Phase 3 — Staging import and reconciliation (implementation exists; validation remains)

The branch has two dry-run-first scripts: `npm run db:migrate:postgres:users` and `npm run db:migrate:postgres:entities`. They are not production-ready cutover authorization. User rows must be mapped before the entity importer can resolve foreign keys. The entity importer currently covers projects, tasks, comments, memberships, dependencies, invitations, project messages/replies/mentions/reactions, activity logs, notifications, and normalized task labels.

Apply mode requires `--apply`, `POSTGRES_IMPORT_CONFIRM=true`, `POSTGRES_IMPORT_TARGET=staging`, and `POSTGRES_IMPORT_DATABASE` exactly matching the database name parsed from `DATABASE_URL`. The target name must contain a standalone `dev`, `test`, or `staging` segment and must not contain production/live naming. These are guardrails only; verify the target independently and complete a backup/restore rehearsal first.

Before any import:
- Confirm the source and target database identities independently and complete a verified backup/restore rehearsal on disposable databases.
- Run the user importer dry-run, resolve conflicts, and verify its planned mapping before considering apply mode. Do not expect the global preflight to be clean before source records have target mappings.
- After user mappings exist, run the entity importer dry-run. Review its blockers and warnings; never guess missing references.
- Run the read-only preflight after each approved staging import to check legacy-ID coverage, relationships, count deltas, and stale/unmapped target rows. A raw count match is not proof of correct mapping.
- Treat each importer as transactional, but note that the user import and entity import are separate transactions. If the second fails, the first is not automatically rolled back.
- After any approved staging import, rerun preflight and verify legacy-ID coverage, relationship integrity, count deltas, and representative application behavior.

Current limitations: this is not a bounded/batched migration framework, and the report does not yet provide a complete per-domain inserted/updated/skipped/quarantined ledger. The current code has no automatic destructive cleanup. Do not run apply mode on production or use a clean preflight as cutover approval.


## Phase 4A — Disposable backup/restore rehearsal (Windows PowerShell)

This is an operator-run rehearsal, not something CI can prove. Use a **dedicated disposable PostgreSQL source and a separate empty disposable restore database**. Never test restore commands against production or the only copy of a database.

1. Confirm the target identity before taking action. Use the configured database name/host from a reviewed connection string, but do not print or paste credentials into logs. Ensure the restore database is not the source database.
2. Create a custom-format backup. Keep the file outside the repository and restrict access because it may contain user data:

```powershell
$env:PGPASSWORD = "<disposable-database-password>"
pg_dump --format=custom --no-owner --no-acl --file ".\kendram-staging-before.dump" "<disposable-source-connection-string>"
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }
```

3. Inspect the archive before restore:

```powershell
pg_restore --list ".\kendram-staging-before.dump" | Select-Object -First 30
if ($LASTEXITCODE -ne 0) { throw "Backup archive inspection failed" }
```

4. Restore into the **separate, empty disposable restore database**. Do not use `--clean` against a database containing data you need:

```powershell
pg_restore --exit-on-error --no-owner --no-acl --dbname "<separate-empty-restore-connection-string>" ".\kendram-staging-before.dump"
if ($LASTEXITCODE -ne 0) { throw "pg_restore failed" }
```

5. Compare source and restored database table counts, migration ledger, critical constraints/indexes, and run the schema checks against the restored database using its connection string. Verify representative read-only API paths in an isolated app instance. Record the backup timestamp, archive size/hash, restore duration, count differences, and any warnings.
6. Only mark the rehearsal successful if the restore completes, counts reconcile, and smoke checks pass. Remove the temporary password from the process environment afterward:

```powershell
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
```

For MongoDB, use the organization's approved backup mechanism and perform any restore only into a separate disposable database. The PostgreSQL rehearsal does not substitute for validating recovery of the MongoDB production source.

## Phase 4B — Application rollback rehearsal

On an isolated staging deployment only:

1. Capture the current feature-flag values and deployment revision.
2. Verify Mongo-backed endpoints are healthy with PostgreSQL flags disabled.
3. Enable only the intended PostgreSQL flag set for the isolated test, then run the documented auth/project/task smoke tests and browser chat acceptance.
4. Simulate a failed PostgreSQL request or failed staging release. Disable/unset `POSTGRES_TASKS_ENABLED` and `POSTGRES_PROJECTS_ENABLED`, redeploy/restart as required, and verify requests return to Mongo-backed routes.
5. Confirm no code path requires PostgreSQL after flags are disabled. Record which database owns any writes made during the rehearsal; flag rollback does **not** undo data already written to PostgreSQL or synchronize divergent writes back to MongoDB.

Do not enable both databases for production writes or claim zero data loss until dual-write/replication and reconciliation behavior is explicitly designed and tested.

## Phase 4 — Cutover and rollback gates

Do not approve cutover until all are true:

- CI is green on the reviewed commit.
- A production-like staging dry run and import have been repeated successfully.
- Entity counts, legacy-ID mappings and foreign-key relationships reconcile with zero unexplained blockers.
- Read-only comparisons cover representative small, large, empty and edge-case projects.
- Authorization, task filters, dependency metadata, comments and activity behavior have been verified.
- A recoverable backup and a rehearsed rollback have been documented.
- An explicit reviewer/owner approves the cutover.

For the current opt-in task API, rollback means setting `POSTGRES_TASKS_ENABLED=false` (or unsetting it) and returning to the Mongo-backed routes. This does not reverse PostgreSQL imports and must not be represented as a database rollback. Do not dual-write or enable the flag in production until consistency and rollback behavior have been separately implemented and tested.
