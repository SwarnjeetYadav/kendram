# PostgreSQL migration readiness and runtime inventory

> **Current project scope (2026-10-27):** Kendram's PostgreSQL work is being validated as a development/testing persistence path against the dedicated `Kendram_db` database. Importing or reconciling existing MongoDB business data is **not a prerequisite for this testing milestone** and must not be treated as the next task. Do not run either importer or the preflight as part of routine feature validation. Create test records through the PostgreSQL API/tests instead; do not seed the database unless explicitly requested. Keep `kendram_pg_dev_test` separate and unchanged. The production cutover and any real-data migration are separate future decisions, not implied by this work.


## Current verified state

- PostgreSQL migrations `001` through `003` were applied locally to the dedicated `kendram_pg_dev_test` database.
- The schema, task service, and HTTP integration tests passed on the local machine.
- Migration `004_application_schema_parity.sql` adds the profile/security fields and relational storage for invitations, notifications, project messages, activity logs, and task time estimates/timestamps.
- The existing MongoDB URI and normal runtime are intentionally unchanged. This is not a full persistence cutover.
- `POSTGRES_PROJECTS_ENABLED` and `POSTGRES_TASKS_ENABLED` remain opt-in. Tests set them only within the integration-test process.
- The opt-in `/api/v1/postgres/projects` API supports CRUD, syncs the authenticated account into PostgreSQL by `legacy_mongo_id`, enforces membership/owner permissions, and provisions a Main Board plus columns transactionally. Membership list/add/role-update/remove and member-candidate search now use PostgreSQL records only; adding or managing an unmigrated MongoDB-only account is intentionally rejected instead of silently querying MongoDB. Project-level assignment suggestions and task-level assignment suggestions now score PostgreSQL project members and active SQL tasks. The opt-in task API supports task CRUD, labels, comments, task activity history, dependencies and blockers. PostgreSQL notifications/preferences, workspace dashboard/search/activity, invitations, project chat, project label CRUD, analytics and insights are also exposed. The frontend route switch `VITE_POSTGRES_API_ENABLED` remains false by default. Existing MongoDB endpoints remain the default. This switch is experimental: an opt-in PostgreSQL authentication service now implements registration, login, email verification/resend, password reset, token validation, and profile updates behind `POSTGRES_AUTH_ENABLED=false` by default. PostgreSQL-native users receive a 24-character legacy-compatible ID so the staged project/task APIs can resolve them. Socket.IO validates PostgreSQL users when auth mode is enabled and authorizes project rooms against PostgreSQL when project mode is enabled. The PostgreSQL auth HTTP lifecycle now has integration coverage for verification, login, bearer-token validation, profile updates, and one-time password reset. Email-provider delivery, registration/resend delivery, Socket.IO realtime E2E, and end-to-end frontend validation remain unverified before production use.
- PostgreSQL project HTTP tests cover authentication, project create/list/fetch/update/delete, owner membership, board/column provisioning, member add/list/role-update/remove, notification/activity side effects, invalid date ranges, and denial of non-members.
- `npm run db:seed:postgres` now idempotently creates synthetic SQL-only demo users, a project, role-specific memberships, a board, columns, and four tasks. Those SQL-only users cannot log into the application until authentication is migrated.

## Persistence route inventory

| API area | Current persistence | PostgreSQL readiness |
| --- | --- | --- |
| Authentication, registration, login, verification and password reset | MongoDB/Mongoose by default | Opt-in PostgreSQL lifecycle service is implemented behind `POSTGRES_AUTH_ENABLED`; HTTP lifecycle integration tests are present; frontend/email-provider validation remains pending. A guarded dry-run-first user importer is available via `npm run db:migrate:postgres:users`; it preserves password hashes and legacy IDs, skips already-mapped accounts, and blocks email conflicts. Run only against a designated staging target after review; full entity migration and reconciliation remain required before cutover |
| Projects and project lifecycle | MongoDB/Mongoose at `/api/v1/projects` | Opt-in `/api/v1/postgres/projects` supports CRUD and transactional board provisioning; default routes remain Mongo-backed |
| Tasks and assignment suggestions | MongoDB/Mongoose at `/api/v1/tasks` | Opt-in slice at `/api/v1/postgres/tasks` supports create/list/update, assignment validation, PostgreSQL-backed assignment suggestions, labels/filtering, comments and dependency operations; default task endpoints and frontend remain Mongo-backed |
| Project membership and member candidate search | MongoDB/Mongoose by default | Opt-in PostgreSQL list/add/role-update/remove/candidate search is SQL-only; accounts must already be present in PostgreSQL. Default routes remain Mongo-backed |
| Invitations | MongoDB/Mongoose by default | Opt-in create/list/respond API exists under `/api/v1/postgres/invitations`; integration tests now cover create/list/accept, duplicate prevention, replay rejection, membership creation, notification side effects, and manager-only authorization. Full frontend and email-provider validation remains pending |
| Comments | MongoDB/Mongoose | Opt-in PostgreSQL task comment list/add endpoints exist; frontend route ownership and full parity remain pending |
| Labels | MongoDB/Mongoose | Opt-in project label CRUD and task label assignment/filtering exist; label-management UI and authorization parity need end-to-end validation |
| Project chat, replies, mentions and reactions | MongoDB/Mongoose by default | Opt-in list/send/reply/mention/reaction endpoints exist; Socket.IO room authorization and message/reaction broadcasts use PostgreSQL when `POSTGRES_PROJECTS_ENABLED=true`; auth handshake can validate PostgreSQL users when `POSTGRES_AUTH_ENABLED=true`; Socket.IO realtime E2E remains pending |
| Notifications | MongoDB/Mongoose | Table now exists; delivery, read state and preference integration remain |
| Activity history/logs | MongoDB/Mongoose by default | Opt-in workspace and project-scoped activity reads combine task lifecycle records from PostgreSQL `activity_history` with project/member/chat/invitation/label events from `activity_logs`. Task-specific activity is exposed by the opt-in PostgreSQL task API; remaining write-event parity and UI validation are still required |
| Dashboard and workspace search | MongoDB/Mongoose by default | Opt-in PostgreSQL summary/search read APIs exist; require broader parity tests and UI validation |\n| Analytics and insights | MongoDB/Mongoose by default | Opt-in project analytics and insights endpoints exist; validate metric parity and frontend consumption |
| Settings | MongoDB/Mongoose by default | Preferences API is opt-in PostgreSQL; remaining account/settings parity pending |

This inventory describes route ownership at the time of this migration branch and is not a claim that all these areas have PostgreSQL implementations.


## Latest code changes — validation status

- Added PostgreSQL-backed member candidate search at `/api/v1/postgres/projects/:projectId/members/candidates` with project-manager/owner authorization and active-user filtering.
- Removed the direct Mongoose `User.findById` lookup from the PostgreSQL member-add controller. Add, role-update, and remove now resolve member identifiers against SQL users and accept either legacy 24-character IDs or PostgreSQL UUIDs.
- Added PostgreSQL-backed assignment suggestions at `/api/v1/postgres/projects/:projectId/assignment-suggestions` and `/api/v1/postgres/tasks/:taskId/assignment-suggestions`; scoring uses SQL memberships and active task workload.
- Updated the frontend route switch so member-candidate search and both assignment-suggestion calls use the PostgreSQL endpoints when `VITE_POSTGRES_API_ENABLED=true`.
- Added HTTP integration assertions for candidate search, project assignment suggestions, task assignment suggestions, and MongoDB-compatible task list filtering (exact label matching, due-date range behavior, unassigned selection, and invalid-filter rejection).
- Hardened the read-only preflight with source-reference, message reply/mention/reaction, activity actor/entity, notification recipient/entity, and target relational-integrity checks. The entity importer covers memberships, dependencies, invitations, project messages/replies/mentions/reactions, activity logs, notifications, and normalized task labels; unresolved references block the transaction. Count deltas and missing target mappings still require reconciliation before any import.
- GitHub Actions run #522 passed all backend, frontend, and container jobs, including the invitation lifecycle regression test and corrected canonical invitation-list endpoint. The latest commit adds explicit MongoDB-compatible task label filtering (case-sensitive equality) and HTTP coverage for label filters, due-date ranges, unassigned filtering, and invalid filter inputs. CI run #524 is queued for this newest change at the time of writing. These tests validate the opt-in development slice only; feature flags remain false by default. Real-data migration/reconciliation is explicitly outside the current development/testing milestone.
## Schema mapping decisions

- UUID primary keys are retained for PostgreSQL relations. `legacy_mongo_id` is a nullable bridge field for explicit identity mapping, not a reason to import disposable test records.
- Task status in the PostgreSQL task slice is derived from the board column. The mapping recognizes `TODO`, `IN_PROGRESS`, `REVIEW`, `BLOCKED`, and `COMPLETED` based on column names. Board/column provisioning must therefore create the corresponding columns before task traffic is enabled.
- Task `estimateMinutes`, `startedAt`, and `completedAt` now have SQL storage.
- User profile, preferences, email verification/reset token hashes, invitations, notifications, project messages, and generic activity logs now have SQL storage.
- Project-message mentions/reactions and user preferences use JSONB because the current MongoDB structures are nested arrays/objects. Validate payload shape and allowed reaction values at the service boundary.
- Notification `entity_id` and activity-log `entity_id` are polymorphic references; they intentionally do not use a foreign key to one specific entity table.

## Safe rollout sequence

1. Apply migrations to a dedicated local PostgreSQL database and run `npm run test:postgres`.
2. Run the existing unit/integration suite and `npm ci` to verify lockfile reproducibility.
3. Add model/service tests for every newly migrated route before changing route ownership.
4. Implement a PostgreSQL vertical slice with explicit service/repository boundaries; keep Mongo routes unchanged until parity is verified.
5. Seed synthetic data only after the schema and API tests pass. Do not use the placeholder password hash for a user who can log in.
6. Deploy with a reversible feature flag and observe error rates/latency. Do not remove Mongo configuration until every required route and background process has been migrated and verified.
7. Do not run destructive resets against a shared/production database.

## Deployment configuration checklist

- `DATABASE_URL`: PostgreSQL connection string from the deployment secret manager; never commit it.
- `PG_SSL`: set according to the managed database's TLS requirements; verify certificate behavior for the chosen provider.
- `PG_POOL_MAX`: tune to the provider connection limit and number of application instances.
- `MONGODB_URI`: retain while any runtime route still uses MongoDB.
- `POSTGRES_AUTH_ENABLED`: keep false until PostgreSQL auth tests pass and existing-account migration/rollback are rehearsed; this mode authenticates SQL accounts only.
- `POSTGRES_PROJECTS_ENABLED`: keep false until the opt-in PostgreSQL project API is intentionally enabled in the target environment.
- `POSTGRES_TASKS_ENABLED`: keep false until the PostgreSQL task API is intentionally enabled in the target environment.
- Run migrations as a controlled deployment step before routing requests to code that requires the new schema.
- Confirm health checks, backup/restore procedures, logs without secrets, and rollback instructions before production cutover.


## Update — guarded account migration and auth tests

The branch includes separate dry-run-first scripts for user and application-entity migration, plus `backend/docs/postgres-user-migration-runbook.md` and `backend/docs/postgres-migration-reconciliation-runbook.md`. Apply mode requires `--apply`, `POSTGRES_IMPORT_CONFIRM=true`, `POSTGRES_IMPORT_TARGET=staging`, and `POSTGRES_IMPORT_DATABASE` exactly matching the database name parsed from `DATABASE_URL`. The database name must include a standalone `dev`, `test`, or `staging` segment and must not contain production/live naming. This is a conservative guardrail, not proof of environment identity; independently verify the connection target and take/verify a backup before any import. User import and entity import are separate transactions; run the user dry-run and review its mappings before the entity dry-run.

The PostgreSQL auth HTTP integration test covers unverified-login rejection, email verification, login, `/auth/me`, profile persistence, single-use password reset, and invalid bearer tokens. Earlier CI runs passed on earlier commits; always use the status for the current branch head to judge the latest changes. No production database was accessed or modified as part of these code changes.
