# PostgreSQL task API rollout and legacy-ID mapping plan

## Current safety boundary

- MongoDB remains the source of truth for authentication and the existing task API.
- `/api/v1/tasks` continues to use the existing MongoDB routes.
- The PostgreSQL task API is mounted only when `POSTGRES_TASKS_ENABLED=true`.
- Leave the flag unset or set to `false` in development and production until the mapping and end-to-end checks below are complete.
- Adding `legacy_mongo_id` columns does not copy data or make an existing MongoDB record available in PostgreSQL.

## Required mapping order

1. **Users:** create PostgreSQL users for active MongoDB users and store each MongoDB ObjectId in `users.legacy_mongo_id`. Preserve email uniqueness and the intended role/status. Validate that every legacy ID maps to at most one SQL user.
2. **Projects:** create projects after their owner users exist; map MongoDB project ObjectIds into `projects.legacy_mongo_id` and set `owner_id` to the mapped SQL user UUID.
3. **Project memberships:** map each MongoDB member and project reference to SQL UUIDs. Preserve project roles, reject duplicate memberships, and report memberships whose user or project is missing.
4. **Boards:** create a PostgreSQL board for each migrated project and set `created_by` to the mapped SQL user. Do not assume every project has a board; report projects that do not.
5. **Board columns:** create columns for each board, preserving the order and mapping legacy task statuses to supported columns. At minimum, map To Do → TODO, In Progress → IN_PROGRESS, Review → REVIEW, Blocked → BLOCKED, and Done/Completed → COMPLETED. Stop and report unknown statuses rather than silently dropping them.
6. **Tasks:** create tasks only after the project, board, column, creator, and optional assignee mappings exist. Store the legacy task ObjectId in `tasks.legacy_mongo_id`. Preserve title, description, priority, due date, version/concurrency policy, and timestamps where supported. Validate that assignees are active members of the mapped project.
7. **Related records:** only after task and user mappings are verified, migrate labels/task-label links, comments, and activity history, preserving references and recording any unsupported records in a reconciliation report.

## Validation before enabling the flag

- Compare source and destination record counts by entity and status.
- Verify every non-null legacy mapping is unique and refers to a valid source record.
- Verify all foreign keys, project owners, memberships, board columns, task creators, and assignees resolve.
- Reconcile unknown task statuses and missing references; do not silently discard them.
- Run a read-only comparison on representative projects and tasks.
- Take a recoverable database backup and document a rollback procedure.
- Run PostgreSQL schema/service tests and HTTP integration tests in CI.
- Enable the flag only in a controlled environment first. Monitor errors and keep the MongoDB API as the fallback until explicit cutover approval.

## Incomplete mappings and rollback

- If a user or project has no PostgreSQL mapping, the PostgreSQL API should fail closed with a clear 403/404/409 response; it must not fall back to a different user's data or implicitly create records during a request.
- If a task's board column or a related foreign key cannot be mapped, quarantine/report that record for correction instead of guessing.
- Do not dual-write or switch the main task routes until consistency, retry behavior, conflict handling, and rollback are explicitly implemented and tested.
- Rollback for the current opt-in slice is to set `POSTGRES_TASKS_ENABLED=false` (or unset it) and continue using the MongoDB task routes. This does not undo data already imported into PostgreSQL, so imports should be repeatable/idempotent and separately auditable.
