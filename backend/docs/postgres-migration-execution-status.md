# PostgreSQL migration execution status — 28 October 2026

## Current decision

**Development/testing only. Do not cut over production.** PR #16 on feat/postgres-persistence must remain Draft and unmerged. MongoDB is the production/default source of truth, and all PostgreSQL feature flags must remain disabled by default.

## Evidence reported by the developer

On commit 10b0476, the developer reported that these local PowerShell commands passed:

- npm run test:postgres — PostgreSQL schema/task-service checks and 17 Vitest tests across four HTTP integration files passed.
- npm test — 19 Vitest tests passed.
- npm run test:integration — 27 Vitest tests passed.

Total reported Vitest tests across these commands: 63, with no failures. These are developer-reported local results, not tests executed by this documentation change. PostgreSQL migrations 001–004 had already been applied to the local development database; a fresh-database migration rehearsal has not been evidenced here.

Commit c44afd2 contains a fix intended to serialize PostgreSQL analytics queries and address a pg client.query concurrency deprecation warning. Do not mark that warning resolved until the latest branch head has a trace-enabled run and the focused plus full relevant suites pass.

## Remaining gates (not complete)

- [ ] **Frontend/API parity:** enumerate actual frontend API callers with PostgreSQL mode enabled. Resolve or explicitly adapt differing route shapes (notably invitations and task comments); compare status codes, DTOs, pagination, filters, validation, and errors.
- [ ] **Authorization parity:** verify owner, administrator, project manager, member, and viewer behavior for reads/writes, missing records, invalid IDs, conflicts, and membership changes against equivalent isolated fixtures.
- [ ] **Live browser chat:** use two real browser sessions to verify same-room delivery, cross-project isolation, immediate membership-removal revocation, denied reconnect after removal, authorized reconnect, and stale/expired-token rejection. Automated unit tests with mocked persistence are not a substitute.
- [ ] **Recovery:** rehearse backup/restore and application rollback on a disposable environment. Demonstrate repeatable migration reconciliation and entity/relationship count checks. No real-data import is authorized by this checklist.
- [ ] **Latest CI:** record completed GitHub Actions status for the exact current branch head and run the relevant full backend/frontend/build checks.
- [ ] **Operational validation:** verify email delivery in a non-production environment and multi-instance Socket.IO fan-out/revocation if the deployment will run multiple instances.

## Safe validation procedure

1. Identify and record the exact branch HEAD before testing.
2. Use only a disposable, explicitly identified non-production database with synthetic fixtures. Do not seed Kendram_db or kendram_pg_dev_test as part of routine validation.
3. Keep POSTGRES_AUTH_ENABLED, POSTGRES_PROJECTS_ENABLED, and POSTGRES_TASKS_ENABLED false unless a specific isolated test requires a flag; restore it immediately afterwards.
4. Run the focused regression test, then npm test, npm run test:integration, npm run test:postgres, and applicable frontend/Playwright checks. Capture exit codes and the exact commit.
5. For rollback rehearsal, take a disposable-environment backup, apply a reversible test change, restore to a separate disposable target, and verify application connectivity and record/relationship counts. Never rehearse destructive restoration against production.
6. Update this file and README after every implementation/verification change. Mark a gate complete only when reproducible evidence is recorded.

## Scope exclusions

This status does not claim full API parity, production migration readiness, successful backup restoration, live browser acceptance, real-data reconciliation, live email delivery, or multi-instance realtime correctness. Green automated tests alone do not establish those properties.


## Frontend/API trace update — 28 October 2026

- Inspected `frontend/src/lib/api.js` against the mounted PostgreSQL routes in `backend/src/routes/index.js`, `postgresTask.routes.js`, `postgresProject.routes.js`, and `postgresInvitation.routes.js`.
- Fixed the API base URL environment variable: the client previously read `import.meta.env.API_BASE_URL`, which is not exposed by Vite by default. It now reads `import.meta.env.VITE_API_BASE_URL`, matching the README deployment configuration. Code commit: `3794db2`.
- The route adapter currently maps project invitations to `/postgres/invitations/project/:projectId`, invitation inbox calls to `/postgres/invitations/mine`, responses to `/postgres/invitations/:invitationId`, task comments to `/postgres/tasks/:taskId/comments`, and project/task routes to their PostgreSQL namespaces.
- This was a source-level trace, not an executed frontend build or live HTTP test. Verify Vercel/build output and API calls on an isolated environment before marking frontend/API parity complete.
- Remaining route-contract risks include the separate backend `POSTGRES_TASKS_ENABLED` gate (task routes will be unavailable if only `POSTGRES_PROJECTS_ENABLED` is enabled), PostgreSQL-vs-Mongo response DTO/error/pagination parity, and profile/auth flows that are not uniformly routed through a PostgreSQL namespace. Do not turn on the frontend switch in production to work around these gaps.


## Testable frontend route mapping — 28 October 2026

- Extracted URL routing into `frontend/src/lib/apiRoutes.js` so the route adapter is pure and can be tested without a browser. `frontend/src/lib/api.js` now imports this function.
- Added `frontend/src/lib/apiRoutes.test.js` with Node's built-in test runner. It covers default MongoDB routes, PostgreSQL project routes, invitation inbox/create/respond paths, task CRUD/dependency/comment/activity paths, settings, dashboard, search, notifications, and auth/profile fallback paths.
- Added `npm run test:routes` in `frontend/package.json` to run these focused tests without adding a new dependency.
- Source changes are committed in `ef86e88`, `69d3517`, `209494a`, and `949b16d`. This GitHub editing session cannot execute the user's local PowerShell commands, so the route tests and Vite build remain pending until run locally or by CI.
- Local environment note: setting `POSTGRES_TASKS_ENABLED=true` only mounts `/api/v1/postgres/tasks/*` on backend startup. It does not enable frontend routing (`VITE_POSTGRES_API_ENABLED=true`), does not enable project/notification/settings routes (`POSTGRES_PROJECTS_ENABLED=true`), and does not change the default MongoDB endpoints. Keep flags aligned only in a disposable local test environment and restart the backend after `.env` changes.


## Route adapter flag wiring correction — 28 October 2026

- A local validation report showed that the expected `npm run test:routes` script was missing from the developer's checkout, although the Vite production build succeeded. The script exists on the remote `feat/postgres-persistence` branch in `frontend/package.json`; this symptom indicates the local checkout does not yet contain that commit (or is using a different branch/working tree).
- Source review also found a real wiring issue: after extracting `routePath` into a pure helper, the API request wrapper called `routePath(path)` without passing `POSTGRES_API_ENABLED`. Since the helper safely defaults to MongoDB mode, frontend requests would have stayed on MongoDB routes even when `VITE_POSTGRES_API_ENABLED=true`. Fixed in commit `17595bc` by passing the flag explicitly.
- The reported `npm run build` succeeded locally, but that build does not test runtime PostgreSQL routing. The focused route tests and build must be rerun from the latest branch head; no CI success is claimed here.


## Latest local frontend verification — 28 October 2026

The developer updated the local checkout by fast-forwarding `feat/postgres-persistence` to commit `9fc2264`, then reported:

- `cd frontend; npm run test:routes`: **7 passed, 0 failed**.
- `npm run build`: **passed** with Vite 8.3.3; 77 modules transformed.
- `npm run test:e2e`: first run had 5 passed and 1 timeout in the Team-view member-search locator after 30 seconds; an immediate second run passed **all 6 Playwright tests** in 5.5 seconds. Treat the first failure as a transient/flaky timeout, not as a fixed root cause; repeat the suite in CI before declaring the flake resolved.

GitHub Actions workflow run 40574991395 (`TeamFlow CI`) reports success for commit `9fc2264`. The Vercel status check is failed with a build-rate-limit/upgrade URL, consistent with the reported account build limit; do not interpret this as an application test failure or claim a successful Vercel deployment.

These results establish route-helper unit coverage, a local production build, and one successful local E2E run. They do not establish live PostgreSQL HTTP parity, full authorization parity, real-browser multi-user chat acceptance, migration recovery, or production readiness. PR #16 remains Draft/unmerged; MongoDB remains production/default.


## Playwright timeout mitigation — 28 October 2026

- The developer's first local E2E run had one 30-second timeout while filling the Team view's user-search input; an immediate rerun passed all six tests. Because the suite was running six workers concurrently and the failure did not reproduce, root cause is not proven.
- Reduced Playwright concurrency in `frontend/playwright.config.js` to three workers locally and two in CI (commit `6d6f40d`) to reduce resource contention on constrained machines/runners. This is a stability mitigation, not evidence that the timeout is fixed. Re-run `npm run test:e2e` on the updated head and observe CI before closing the flake.


## Follow-up Playwright verification — 28 October 2026

After pulling commit `fb156cb`, the developer reran `npm run test:e2e` locally with the new three-worker cap. All six Chromium tests passed in 5.7 seconds, including the Team view/member search/chat scenario that had timed out on the first run. This is positive evidence that the concurrency mitigation helps locally; CI confirmation on the new commit is still needed before treating the intermittent timeout as fully resolved.

## Latest CI status check — 28 October 2026

- GitHub Actions `TeamFlow CI` run #577 (run ID `40576702099`) completed successfully for commit `f53cff70d897fecf01c4014d5a2eda750b6494d1`.
- The combined status for that commit reports Vercel failure at the build-rate-limit/upgrade URL. No successful Vercel deployment is claimed; this is distinct from the successful GitHub Actions workflow.
- This evidence applies to that exact commit only. Any later source change requires checking CI for its own commit before calling it green. Backend/API parity, authorization matrix, live two-browser chat, recovery rehearsal, and production cutover remain open.

## Backend contract implementation — task activity — 28 October 2026

- Fixed a confirmed response-shape mismatch: PostgreSQL task activity previously returned a simplified audit list, unlike the MongoDB endpoint's merged event stream. The PostgreSQL implementation now emits activity and comment events with `id`, `type`, `action`, `message`, `metadata`, `user`, and `createdAt`, sorted chronologically and capped to the latest 150 events. Code commit: `b979a5a`.
- Added PostgreSQL HTTP integration assertions for task creation, comment activity, and comment events in commit `3a7550d`.
- **Verification pending:** this GitHub editing session did not execute the backend integration tests or connect to the developer's local PostgreSQL database. Check CI for the latest source/test commit and run the isolated `npm run test:postgres` suite locally after pulling the branch. Do not run seed/import scripts or use production data.

## CI follow-up — task activity contract test — 28 October 2026

- CI run #582 exposed a test-file syntax error: the new activity assertion reused an existing `taskActivity` constant name. The production service change was not the reported failure; the integration test module could not load. Commit `50d359d` renames the second variable to `commentActivity` to remove the duplicate declaration.
- The failing run's backend unit tests passed (46 tests across the run summary), but coverage/integration/PostgreSQL steps were skipped after the syntax failure. The fix is not considered verified until CI completes on commit `50d359d` and the PostgreSQL HTTP integration suite executes.

Follow-up from CI run #586: the first activity-shape assertion revealed the new PostgreSQL formatter used generic lowercase action text (`task created`) rather than the exact MongoDB-compatible display text (`created the task`). Commit `f66eb63` adds the same action-to-message mapping used by the Mongo task activity controller. CI and PostgreSQL HTTP integration must pass on this follow-up before this parity fix is closed.

Follow-up from CI run #590: the activity assertion confirmed that PostgreSQL comments write their `COMMENT_ADDED` audit entry to `activity_logs`, not `activity_history`. The feed initially merged `activity_history` and comments but therefore omitted the activity-form comment event. Commit `84cf3ee` adds the task-scoped `activity_logs` records to the combined feed. The focused PostgreSQL integration assertions and full CI must pass on this commit before declaring the response contract verified.


### Invitation DTO follow-up — 28 October 2026

Commit `8cc995b` adds nested populated-style invitation references to PostgreSQL invitation responses while preserving existing flattened fields. This reduces a known contract mismatch with the MongoDB invitation service, but does not close the invitation parity gate: automated response-shape assertions, status/error parity, and frontend behavior still need verification on the latest head. Keep all PostgreSQL flags disabled by default and PR #16 Draft.


### Invitation DTO test follow-up — 28 October 2026

Run #598 failed in `test:coverage` because an existing PostgreSQL invitation integration assertion still expected a scalar `invitedUserId`. The service change now intentionally returns the Mongo-compatible nested populated object. Commit `7a15938` updates the assertions to validate nested invitee identity/details and nested list results. Confirm CI on this exact commit before considering the change validated; no local database tests are claimed from this editing session.


### Invitation validation follow-up — 28 October 2026

Commits `b56a1a4` and `e74ec87` add explicit invitation UUID/action validation and HTTP integration checks for invalid invitation IDs, invalid actions, and malformed invitee IDs; the PostgreSQL service now distinguishes missing/inactive invitees from an unmapped authenticated actor. These changes require CI confirmation. Invitation expiration semantics, full permission matrix, and production migration gates remain incomplete.

Commit `403b7ef` adds a regression check that an expired PostgreSQL invitation remains marked `EXPIRED` after the API returns 409. This is synthetic-fixture CI coverage only; confirm the latest workflow before recording it as passed.


Commit `3d4824b` adds a PostgreSQL HTTP regression assertion that a user cannot mark another account's notification as read. CI confirmation is pending on this commit. This is an isolated synthetic test fixture and does not alter production data.

Commit `ffab226` adds assertions for successful owner notification-read and idempotent repeated-read behavior, in addition to cross-user denial. This test awaits CI confirmation on the latest head.

Commit `b3568a2` adds an integration assertion that a non-manager cannot change a project member's role; it expects the API's existing 403/404 authorization-hiding behavior. CI verification is pending.


Commit `4ae8d37` adds isolated HTTP integration assertions for PostgreSQL preference validation/persistence, dashboard summary shape, and project search scope. Await CI on this exact commit; do not infer full parity from the new focused checks.

Commit `f7e3440` adds a PostgreSQL task HTTP regression assertion for viewer write denial while retaining the existing viewer comment behavior. CI verification is pending.

Run #627 failed before executing the project HTTP suite because a new dashboard assertion reused an existing `const dashboard` binding. Commit `848e756` renames the new binding. The test suite has not been considered verified until CI passes on the corrected commit.

Run #635 found another compile-time duplicate (`search`) in the project HTTP integration test after the dashboard binding fix. Commit `e65eb28` renames the new binding to `projectSearch`. The new assertions remain unverified until CI passes on the corrected head.


### Cutover/rollback planning gate — 28 October 2026

Added `backend/docs/postgres-cutover-and-rollback-gates.md` in commit `e413b1e`. It records staging-only preconditions, backup/restore proof, per-feature rollout gates, rollback steps, and current blockers. This is a documented rehearsal plan, not evidence that a staging backup/restore or rollback has been executed. Production cutover remains unauthorized.

Run #639 reached the new project-search assertion and exposed a test expectation mismatch (`name` expected versus actual `title` DTO). Commit `79fbe0e` corrects the assertion to `{ type: 'PROJECT', title: ... }`; latest CI confirmation is pending.

Run #646 found a test-order issue: new preference updates changed the shared fixture before an existing default assertion. Commit `319a160` moves the added preference mutation checks after the default assertion. Latest CI must confirm the fix.


Authentication follow-up: commit `04778d8` adds a synthetic PostgreSQL HTTP test for expired email verification tokens, including an assertion that the account remains unverified. The latest CI result for this commit is required before marking the test as passed. Production auth cutover and live email delivery remain unverified.

Run #654 found that the expired-email test mutated the shared auth account and made the password-reset test fail. Commit `353b0ab` isolates the expiry case in a separate synthetic account and cleans it up in `finally`; verify latest CI before treating it as passed.


Realtime follow-up: commit `2da11cf` adds a Socket.IO test for denied project-room joins when PostgreSQL authorization rejects membership. Confirm CI on the latest branch head. This supplements, but does not replace, real-browser testing against a deployed PostgreSQL-enabled staging environment.


### Local verification evidence supplied by project owner — 28 October 2026

The owner ran the commands on Windows PowerShell after pulling branch head `068aac8`:

- `npm run test`: 4 files, 20 tests passed.
- `npm run test:integration`: 8 files, 28 tests passed.
- `npm run test:postgres`: schema/migration checks passed; task service integration checks passed; 4 PostgreSQL HTTP integration files passed (18 tests).

These are owner-reported local results, not independently executed by this documentation change. The PostgreSQL scripts skipped migrations 001–004 because they were already applied in the configured database. This does not prove backup/restore, data reconciliation, deployed email delivery, or browser-level realtime acceptance. Confirm the configured database is disposable before future tests that write records.


## PostgreSQL task assignment notification parity — 28 October 2026

- Source comparison confirmed that MongoDB task creation creates a `TASK_ASSIGNED` notification for an assigned user and honors `preferences.notifications.taskAssignment`; the PostgreSQL task create/update service previously omitted this side effect.
- Commits `5940162` and `39e32a2` add preference-aware notification inserts for PostgreSQL task creation and newly assigned task updates, plus an HTTP integration regression test covering enabled and disabled recipient preferences.
- **Verification pending:** run the focused `npm run test:postgres` suite on the current branch head. This is a targeted regression check for a behavior gap, not a request to restart the full validation cycle. Do not seed or import data to validate it.


## Owner-reported regression results after fast-forward — 28 October 2026

The developer pulled the latest branch through `68269b3` and reported these local results:

- `backend/npm test`: 4 files, 20 tests passed.
- `backend/npm run test:integration`: 8 files, 28 tests passed.
- `frontend/npm run test:routes`: 7 passed, 0 failed.
- `frontend/npm run build`: passed (Vite 8.3.3, 77 modules transformed).
- `frontend/npm run test:e2e`: first run had 5 passed and one 30-second timeout waiting for the Team view's `Search users to add` locator; immediate rerun passed all 6 tests in 5.8 seconds. The timeout is still classified as intermittent, not a proven product defect or conclusively fixed flake.
- `backend/npm run test:postgres`: previously reported passed on this local setup, including schema/task-service checks and 18 HTTP integration tests, before the latest task-notification parity change.

The latest task-assignment notification fix and its focused regression assertions were added after these reported test runs. Run only the focused PostgreSQL suite to validate that new behavior; no need to repeat the already-green frontend/full-suite checks unless subsequent changes touch them.


## Assignment-notification test fixture correction — 28 October 2026

The first focused `npm run test:postgres` run after the notification change reported 18 passing tests and one failure in the new reassignment assertion. The fixture attempted to assign the task to the project owner, who is not represented as a `project_members` row; the PostgreSQL task API correctly rejects that assignee as not an active project member. This was a test-fixture mistake, not evidence that the notification insert failed. Commit `e85bfc0` changes the fixture to use a second eligible `MEMBER` account for reassignment, preserving the production authorization rule. Re-run `npm run test:postgres` once to verify the corrected regression test; do not broaden into the full test cycle.


## Assignment-notification regression verified — 28 October 2026

The project owner pulled branch head `62aebf6` and reported `npm run test:postgres` passing locally:

- PostgreSQL schema/migration checks passed; migrations 001–004 were correctly skipped as already applied.
- PostgreSQL task-service integration checks passed.
- All four PostgreSQL HTTP integration files passed: 19/19 tests, including task assignment notification preferences and reassignment to an eligible project member.

GitHub Actions `TeamFlow CI` also reports success for exact head `62aebf6baeab138d542165c092553b13fd768046`. Vercel's status remains failed with a build-rate-limit/upgrade URL; this is not evidence of an application test failure or a successful deployment.

This closes the targeted assignment-notification regression check only. Full route/DTO/permission parity, real-browser PostgreSQL chat acceptance, and staging backup/restore and rollback rehearsal remain open. Keep PR #16 Draft, MongoDB as production source of truth, and PostgreSQL flags disabled by default.


## Identifier-validation parity follow-up — 28 October 2026

Source comparison found two malformed-ID differences: MongoDB notification-read handling returns HTTP 400 for malformed ObjectIds, while PostgreSQL notification reads previously returned 404; PostgreSQL task-comment routes also returned not-found for malformed task IDs rather than validation errors. Commits `a04258c` and `e7d7bce` now validate PostgreSQL notification IDs as UUIDs and comment task IDs as legacy 24-character hex IDs or UUIDs. Regression assertions were added in `6b059f3` and `522473c`.

**Verification pending:** run `npm run test:postgres` once from the updated branch head. Do not mark this fix verified until the PostgreSQL HTTP integration suite passes. This validation change does not alter default MongoDB routing or authorize enabling PostgreSQL in production.


## Identifier-validation regression correction — 28 October 2026

The first local `npm run test:postgres` run after adding malformed-ID checks exposed an escaping mistake in the new JavaScript regexes: `\\d` was written with an extra backslash, so valid digit-containing UUIDs/ObjectIds were rejected with HTTP 400. This caused the notification-read and task-comment happy paths to fail. The invitation test then returned 409 because the earlier membership test aborted before removing its viewer fixture; this is a downstream consequence of the first assertion failure, not a separate invitation-service regression. Commits `9fc70e0` and `3450d78` correct the regex escaping. Re-run the focused PostgreSQL suite on the latest branch head to verify all paths; no production database operation is needed.

## Identifier-validation regression verified — 28 October 2026

The project owner pulled commit `e5760d4` and reported `npm run test:postgres` passing locally. Schema/migration checks and PostgreSQL task-service integration checks passed; all four PostgreSQL HTTP integration files passed (19/19 tests). This verifies the valid-ID notification-read and task-comment paths, malformed-ID validation, and the dependent invitation flow in the configured local test environment. No migration reset or production database operation was needed.

This closes the identifier-validation regression only. Remaining gates include endpoint-by-endpoint DTO/error/permission parity, real-browser PostgreSQL chat acceptance, disposable staging backup/restore and rollback rehearsal, and latest-head CI confirmation. Keep PR #16 Draft, MongoDB as production source of truth, and PostgreSQL flags disabled by default.

## Migration preflight duplicate-mapping coverage — 28 October 2026

Commit `8e9b72e` extends the read-only PostgreSQL integrity checks to detect duplicate `legacy_mongo_id` mappings in task dependencies, comments, invitations, notifications, project messages, and activity logs, plus duplicate project/user membership pairs. These checks are added to the existing blocker-producing integrity-check list and issue only `SELECT` queries. They do not mutate source or target records.

This is a targeted improvement to migration diagnostics, not proof that the full source-domain importer is complete. The preflight intentionally continues to set `readyForImport: false` while the importer does not cover all source domains. Run `npm run db:preflight:postgres` against designated disposable/staging credentials and run the focused PostgreSQL suite before treating the change as verified. Do not use production credentials or enable PostgreSQL feature flags.

## Legacy-ID bridge schema coverage — 28 October 2026

Reviewing the new duplicate-mapping checks against the actual migrations exposed a schema prerequisite: `project_members`, `invitations`, `notifications`, `project_messages`, and `activity_logs` did not yet have `legacy_mongo_id` columns. Added migration `005_application_legacy_id_bridge.sql` in commit `e8fe4e1` to add nullable legacy-ID columns and partial unique indexes for those tables. This is additive; existing rows remain unmapped until a separately reviewed importer populates the bridge.

**Required verification:** pull the latest branch, run `npm run db:migrate:postgres` against the designated disposable local test database (migration 005 should apply once), then run `npm run test:postgres` and `npm run db:preflight:postgres` only with designated non-production/staging credentials. The preflight remains intentionally blocked for import readiness while entity coverage is incomplete. Do not run these commands against production.

## Latest schema and PostgreSQL HTTP verification — 28 October 2026

The project owner pulled commit `dc3c710` and reported `npm run test:postgres` passing locally against the configured local PostgreSQL database:

- Schema tests passed, including migrations 001–005 (already applied), application schema parity, foreign keys, unique/check constraints, and core relational inserts.
- PostgreSQL task-service checks passed for create, list/filter/pagination, update, stale-version conflicts, non-member denial, viewer read-only behavior, invalid IDs, and administrator access.
- PostgreSQL HTTP integration tests passed: 4 files, 19/19 tests (auth, task, project, and project-mapping).
- GitHub Actions `TeamFlow CI` run #690 completed successfully for `dc3c7102c6abd4a3e5b90eef6a2ccae1530e66bb`. The GitHub Vercel status for that same commit currently reports success; this does not establish that PostgreSQL-enabled staging was exercised.

The `project_members` schema-test failure was caused by omitting the table from the test's table-discovery allow-list and is fixed in `dc3c710`. No database reset or import was performed.

**Migration completion is still blocked.** The entity importer does not yet import and reconcile all source domains (project memberships, dependencies, invitations, project messages, activity logs, notifications, and normalized task labels/links). The preflight therefore correctly remains `readyForImport: false`. Backup/restore and rollback rehearsal, broader API parity, and real-browser PostgreSQL chat acceptance also remain open. Keep PR #16 Draft and keep PostgreSQL runtime flags disabled by default.

## Importer coverage expansion — 28 October 2026

The staging-only entity importer was extended on the current branch to import project memberships, task dependencies, invitations, project messages (including task references, mentions, reactions, and replies), normalized task labels/task-label links, activity logs, and notifications in the same transaction as the covered project/task/comment records. It validates source references and blocks unknown or dangling polymorphic activity/notification entity references rather than guessing mappings. Existing dependency edges can be reconciled to their source legacy ID.

The read-only preflight now checks source-to-target legacy-ID coverage for all imported application collections and adds relationship comparisons for memberships, invitations, messages, activity logs, and notifications, alongside the existing user/project/task/comment checks.

**Verification is pending.** These changes were committed through GitHub editing and have not yet been run against the developer's local MongoDB/PostgreSQL pair. Do not run `--apply` yet. First pull the branch, run syntax/test checks, and run the importer in dry-run mode against the designated disposable staging database. Inspect every blocker and warning; then run the read-only preflight and verify it reports the expected mappings and relationships. A clean import report alone is not cutover approval. Payload-level message mention/reaction reconciliation, full data parity, backup/restore rehearsal, rollback rehearsal, and PostgreSQL-enabled browser acceptance still require explicit verification. Keep production flags disabled and PR #16 Draft.


## Read-only preflight follow-up — 28 October 2026

- The developer ran `npm run db:preflight:postgres` after commit `86ad3e5`. The command completed in `READ_ONLY` mode with MongoDB source counts of 5 users, 1 project, 2 tasks, 1 comment, 2 memberships, 18 project messages, 27 activity logs, and 4 notifications. The PostgreSQL target tables were empty.
- The report correctly remained `readyForImport: false`: source records did not yet have PostgreSQL legacy-ID mappings, and raw source/target count deltas remained. No PostgreSQL writes were performed by preflight.
- Commit `6881d29` adds preflight checks for dangling message replies, mention/reaction user references, supported activity-log entity references, and notification entity references. It removes the stale warning that all embedded task labels require an explicit mapping, because the entity importer normalizes labels into `labels`/`task_labels`.
- **Verification pending:** the latest preflight edit has not yet been run locally or in CI. Re-run syntax checks, PostgreSQL tests, and read-only preflight on the exact latest branch head before treating these checks as verified.
- The entity dry run is expected to report unmapped owner/task/comment relationships while PostgreSQL has no imported users/projects/tasks. Do not bypass these blockers. Review the user-migration dry run, explicitly identify a disposable non-production target, and only then consider a separately authorized staging apply. Do not import into production or enable PostgreSQL runtime flags.


## Import target safety guard — 28 October 2026

- Commits `60ddc90` and `bd3e237` harden both user and entity import scripts. A write now requires `POSTGRES_IMPORT_CONFIRM=true`, `POSTGRES_IMPORT_TARGET=staging`, `POSTGRES_IMPORT_DATABASE` exactly matching the database name parsed from `DATABASE_URL`, and a database name clearly containing a `dev`, `test`, or `staging` segment. Names containing `prod`, `production`, or `live` are rejected.
- This is a guardrail, not proof that a database is disposable. Before any `--apply`, a human must still verify the actual connection target and that it contains no valuable data. Dry-run and read-only preflight remain the default workflow.
- Latest importer guard changes have not yet been syntax-checked or executed locally/CI. Do not set the write flags or run `--apply` just to test the guard.
