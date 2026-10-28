# PostgreSQL staging, migration, and cutover gates

This runbook is an execution checklist, not evidence that a deployment or migration has already happened. The currently verified branch CI is not a substitute for running these steps against the actual staging service.

## Safety rules

- Keep the current MongoDB-backed deployment as the rollback target until all gates below pass.
- Never point staging or migration scripts at a production database while testing.
- Never paste database URLs, passwords, JWT secrets, email API keys, or backup contents into GitHub issues or chat.
- Keep `POSTGRES_AUTH_ENABLED`, `POSTGRES_PROJECTS_ENABLED`, and `POSTGRES_TASKS_ENABLED` false until the relevant staging acceptance checks pass.
- Do not enable `VITE_POSTGRES_API_ENABLED` on the live frontend before backend and data acceptance is complete.
- A database name check is only a guardrail; verify the actual provider/project/host independently.

## Gate 0 — establish isolated staging

1. Create a dedicated PostgreSQL staging database with a clearly named database such as `kendram_staging` (not the production database).
2. Restrict credentials to the application and migration operators. Require TLS according to the provider.
3. In the Render staging service, configure `DATABASE_URL` to that staging database, `PG_SSL=true` when the provider requires verified TLS, and `PG_POOL_MAX` to a value within the provider's connection limit.
4. Keep MongoDB configured because any route not switched to PostgreSQL still uses it.
5. Leave all PostgreSQL feature flags false initially. Confirm the health endpoint and current MongoDB-backed login/project/task flows still work.
6. Record the Git commit SHA and the staging database/provider identity. Do not commit secrets.

## Gate 1 — schema and API validation

From `backend/` with the staging environment loaded:

```bash
npm ci
npm run db:migrate:postgres
npm test
npm run test:integration
npm run test:postgres
```

Then run the frontend build and E2E suite. Confirm the tested commit is the one deployed to staging. Test PostgreSQL auth, project CRUD and membership roles, task CRUD and filters, assignment, comments, labels, dependencies, invitations, notifications, activity, analytics, chat/replies/reactions, and unauthorized/non-member access. Verify email verification and password reset using the configured provider, not only a mocked test.

## Gate 2 — inventory and dry runs

1. Take a provider-native backup/snapshot of the staging database and verify the backup job succeeded.
2. Run the user importer without `--apply`; save the redacted JSON report outside the repository.
3. Review every blocker and identity conflict. Do not proceed with blockers.
4. Run the entity importer without `--apply`; review every planned insert, skipped record, unsupported field, and reference blocker.
5. If importing retained MongoDB data, pause writes or establish a final reconciliation window. Counts alone are not proof: verify legacy-ID mappings, foreign keys, role/status mappings, labels, dependencies, replies, mentions, reactions, activity actors/entities, and notification recipients/entities.

## Gate 3 — staging import and reconciliation

Only after the target identity, backup, and both dry-run reports have been reviewed, use the exact staging database name in the guarded importer confirmation variables. The name must contain a standalone `dev`, `test`, or `staging` segment and must not contain production/live naming.

PowerShell example (replace the database name only after verifying the actual target):

```powershell
$env:POSTGRES_IMPORT_TARGET = 'staging'
$env:POSTGRES_IMPORT_CONFIRM = 'true'
$env:POSTGRES_IMPORT_DATABASE = 'kendram_staging'
npm run db:migrate:postgres:users -- --apply
npm run db:migrate:postgres:entities -- --apply
npm run db:preflight:postgres
```

Do not run these commands against production. Save the reports securely and check that all mapping/integrity blockers are zero. Explain every count delta and excluded record. If either import fails, investigate the transaction result and re-run the dry run before retrying; do not blindly repeat writes.

## Gate 4 — backup/restore and rollback rehearsal

1. Create a fresh PostgreSQL backup using the provider's documented backup/export procedure.
2. Restore it into a separate disposable database, never over the staging source.
3. Run migrations/status checks and representative read/write tests against the restored copy.
4. Record restore duration, row counts, and successful login/project/task smoke tests.
5. Rehearse switching the staging frontend/backend flags back to MongoDB and verify that the previous Mongo-backed routes still work.
6. Keep the MongoDB source unchanged and available until cutover is accepted. Do not assume writes made only in PostgreSQL will magically appear in MongoDB after rollback; define a write freeze or reverse-sync strategy before production cutover.

## Gate 5 — staging feature-flag acceptance

Enable PostgreSQL flags only in staging, in a controlled sequence. Test each enabled slice and monitor errors, latency, database pool saturation, authorization failures, and logs. Test with at least two accounts and different project roles. Confirm frontend route switches and realtime chat work against the deployed services.

A staging sign-off must include:
- Exact tested commit SHA and deployed service version
- CI run URL and passing test results
- User/entity import reports and reconciled counts (if importing data)
- Backup ID and successful restore-test evidence
- Auth, authorization, task/project, chat, and frontend E2E results
- Known limitations, monitoring, rollback owner, and rollback steps

## Gate 6 — production cutover decision

Do not switch production until every prior gate is signed off. Before cutover, take a fresh verified backup of both systems, pause or reconcile writes, run the final import/reconciliation, and define the point at which PostgreSQL becomes authoritative. Enable the production flags only for the validated commit and only after schema migrations complete. Smoke-test login, project membership, task CRUD/assignment, comments, notifications, and chat immediately after release.

If any critical smoke test fails, disable the PostgreSQL flags and restore the known-good MongoDB deployment. Because dual writes are not assumed, decide how to preserve any post-cutover PostgreSQL-only writes before rollback.

## Current known blockers

The repository has PostgreSQL opt-in API implementations and CI tests, but this runbook does not assert that an actual Render staging service/database exists, that imports have been applied, that data has been reconciled, that a backup has been restored, or that a live PostgreSQL cutover has occurred. Those require execution against the real provider environment and retained credentials.
