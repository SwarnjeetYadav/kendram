# PostgreSQL validation and recovery runbook

Status date: 2026-10-27  
Branch: `feat/postgres-persistence`  
Scope: local/isolated development validation only. This runbook does not authorize production cutover.

## Safety invariants

- Keep PR #16 open as a Draft.
- Keep MongoDB as the default persistence path.
- Keep `POSTGRES_AUTH_ENABLED`, `POSTGRES_PROJECTS_ENABLED`, `POSTGRES_TASKS_ENABLED`, and frontend `VITE_POSTGRES_API_ENABLED` disabled in production.
- Use only the already designated local `Kendram_db` target for the requested feature validation. Do not use `kendram_pg_dev_test` as a substitute; do not reset, seed, import, or preflight either database as part of this checklist.
- Do not run MongoDB importers or migration preflight for routine feature validation. Real-data migration/reconciliation is a separate future approval.
- Never paste connection strings, JWT secrets, email-provider keys, verification/reset tokens, or personal data into issue comments, logs, screenshots, or chat.

## 1. PostgreSQL API behavior checks

The existing CI suite has passed the schema, task service, auth HTTP, task HTTP, project HTTP, and project-mapping HTTP test commands. That is CI evidence, not proof of a local connection to `Kendram_db`.

From `backend/`, after independently verifying the intended database name in your local PostgreSQL client/provider dashboard, run only the non-import test commands already used by the project:

```powershell
npm ci
npm test
npm run test:integration
npm run test:postgres
```

Do not share the value of `DATABASE_URL`. If you need to verify the selected database, run a local SQL query using the same connection configuration without printing credentials:

```sql
SELECT current_database() AS database_name, current_user AS database_user;
```

Expected database name for this task: `Kendram_db`. If it does not match, stop; do not change databases or run migrations without reviewing the target first.

Record pass/fail for each behavior using synthetic test accounts created by tests or through the PostgreSQL API:
- Authentication: unauthenticated requests rejected; verified login accepted; unverified login rejected; invalid/expired bearer token rejected; password-reset token single-use.
- Project access: owner/member can access permitted project; non-member cannot read or mutate it; manager-only membership actions reject unauthorized roles.
- Membership: add/list/update-role/remove and candidate search use PostgreSQL records only; reject unknown/unmapped users rather than falling back to MongoDB.
- Tasks: create/update/list; valid project membership and assignee; reject invalid assignee/project; labels, date ranges, unassigned filter, dependencies/blockers; invalid filters return a safe client error.
- Error handling: malformed IDs/payloads and missing records return expected 4xx responses; unexpected database errors do not leak SQL, tokens, or secrets.

Do not claim these local checks are complete until the operator has run them against `Kendram_db` and captured pass/fail results. Existing CI test success must not be relabelled as a local database test.

## 2. Socket.IO realtime checks

Current readiness notes say the PostgreSQL-aware handshake and project-room authorization are implemented, but realtime end-to-end behavior remains unverified. Run this only against an isolated local app using synthetic users and a private test project. Do not enable flags in production.

With PostgreSQL auth/project mode enabled only in the isolated process:
1. Connect as a valid PostgreSQL user with a valid bearer token; expect connection success.
2. Connect with missing, invalid, expired, and non-PostgreSQL-user tokens; expect rejection.
3. Join a project room as an owner/member; expect success.
4. Attempt to join as an authenticated non-member; expect rejection and no room subscription.
5. Send a message; assert the authorized second client receives exactly one event with the expected project/message identifiers and payload.
6. Send a reply and mention; verify the expected event/payload and no cross-project leakage.
7. Add/remove a valid reaction; verify persisted reaction state and one broadcast to authorized room members.
8. Confirm an unauthorized client never receives messages/reactions for a project room it cannot join.
9. Disconnect/reconnect and repeat a send to check for duplicate listeners or duplicate broadcasts.

Record test output and exact commit SHA. If no automated Socket.IO integration test exists yet, add one before marking this section complete. A manual browser smoke test alone is not sufficient evidence for room isolation.

## 3. Email verification and password-reset delivery

The auth HTTP lifecycle tests validate token/state transitions, but delivery through the configured email provider is not yet verified.

Use a provider sandbox or local mail-catcher with a dedicated test recipient:
- Register an unverified synthetic user; assert one verification email is accepted by the provider/catcher.
- Verify the link/token; assert account state changes and token cannot be reused.
- Request a resend; assert rate limits apply and the old token behavior matches the intended policy.
- Request password reset; assert one reset email is delivered without revealing whether an arbitrary email address exists.
- Complete reset; assert the new password works, old password fails, and reset token cannot be reused.
- Exercise provider timeout/rejection; assert a safe error response, no token/secret in logs, and no false “email sent” success.
- Check URL origin, HTTPS in deployed non-local environments, token expiry, and rate limiting.
- Verify sender/domain configuration and delivery status in the provider dashboard without exposing API keys.

If the app has no injectable mail adapter/provider sandbox configured, record delivery as blocked and implement/test a provider adapter rather than marking this step passed. Never send test mail to real users during validation.

## 4. Frontend workflow with PostgreSQL enabled

Use a disposable local frontend/backend environment with synthetic records only. Keep deployed Vercel/Render settings unchanged. Set the frontend build-time `VITE_POSTGRES_API_ENABLED=true` only for the isolated local build, and set backend PostgreSQL flags only for that local process. Confirm the frontend and backend point at the same isolated test environment.

Smoke-test:
- Login/register, verification/resend, logout and password reset.
- Project list/create/open/update/delete and board/column creation.
- Member list/search/add/role update/remove and unauthorized-state messaging.
- Task create/edit/assign/unassign, status/column change, label filters, due-date filters, dependencies and comments.
- Dashboard/search/activity/analytics, notifications/preferences, invitations and project chat/replies/reactions where those screens are wired.
- Loading, empty, validation, permission-denied, server-error, refresh, and session-expiry states.
- Browser network requests use the intended `/api/v1/postgres/*` endpoints for covered features; no silent fallback to MongoDB for a PostgreSQL-only action.
- Confirm default local/prod configuration with the flag absent/false continues to use MongoDB.

Capture failing workflows, console errors, and network status codes, but redact cookies, Authorization headers, tokens, email addresses, and connection data. If a feature is not wired to PostgreSQL yet, list it as a parity gap rather than passing the whole frontend.

## 5. Backup, restore, and rollback rehearsal

This section is a required pre-cutover gate. Do not rehearse on production or on `Kendram_db` if it contains anything you cannot afford to lose. Create a separate disposable PostgreSQL database for recovery rehearsal; this does not replace the designated validation target.

### Backup/restore
1. Confirm the database name and host before each command.
2. Take a custom-format logical backup of the disposable rehearsal database:
   `pg_dump --format=custom --no-owner --file=kendram-rehearsal.dump <REHEARSAL_DB_NAME>`
3. Restore into a newly created empty disposable database:
   `pg_restore --clean --if-exists --no-owner --dbname=<RESTORE_DB_NAME> kendram-rehearsal.dump`
4. Compare schema objects, migration versions, row counts for the synthetic fixture tables, foreign-key validity, and application-level reads.
5. Start the isolated app against the restored database and run smoke tests.
6. Record backup timestamp, PostgreSQL client/server versions, command exit codes, restore duration, and verification results. Keep backup files and connection secrets out of Git.

Use PowerShell-safe quoting for your actual database names/connection settings. Do not run `pg_restore --clean` against a shared or production database.

### Application rollback
- Feature-flag rollback means routing traffic back to MongoDB; it is **not** a PostgreSQL database rollback and does not undo writes already made to PostgreSQL.
- Before enabling any production flag, define which database is authoritative, how writes are handled during rollback, and how divergence/dual writes are reconciled. Do not enable simultaneous write paths without an explicitly tested consistency design.
- Rehearse in an isolated environment: take a backup; enable only the necessary local PostgreSQL flag; exercise the scoped workflow; disable the flag; verify the MongoDB-backed default works; inspect both stores for expected writes/divergence; restore the disposable PostgreSQL snapshot; verify the app still starts and MongoDB routes remain functional.
- Establish a recovery owner, RPO/RTO targets, alerting, and a documented decision point for stopping/rolling back. Do not remove MongoDB configuration until full route/background-job parity and reconciliation are complete.

## Evidence and sign-off table

Update this table only after the listed checks actually run. “CI passed” is not evidence that local/provider/manual steps passed.

| Area | Evidence required | Status at authoring |
| --- | --- | --- |
| CI / existing automated tests | Latest GitHub Actions run and commit | Passed for commit `42c3575215948fa584c92288b2dadf7739bbdb8f` (run #532); rerun after documentation/test changes |
| Local PostgreSQL behavior on `Kendram_db` | Local command output + selected database name, secrets redacted | Pending operator execution |
| Socket.IO authorization/delivery/reactions | Automated integration test results on isolated app | Pending; E2E not verified |
| Email provider delivery | Sandbox/catcher delivery evidence and failure-path test | Pending; provider delivery not verified |
| Frontend PostgreSQL workflows | Isolated end-to-end smoke test report | Pending; full frontend parity not verified |
| Backup/restore | Disposable-database restore and integrity report | Pending operator execution |
| Rollback rehearsal | Flag rollback plus MongoDB default smoke-test evidence | Pending operator execution |

## Cutover decision

Do not mark this migration production-ready until the pending items above have evidence, route parity and data reconciliation are reviewed, and the repository owner explicitly approves a separate cutover plan. PR #16 remains Draft and unmerged until then.
