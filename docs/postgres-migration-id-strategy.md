# Decision 4 — Preserve legacy MongoDB IDs during PostgreSQL cutover

**Status:** Accepted for the migration branch; no runtime cutover yet.

## Decision

Keep PostgreSQL-generated UUIDs as the primary keys for relational rows. During the staged migration, store each source MongoDB document ID in a nullable, unique `legacy_mongo_id` column on the corresponding relational entity. This is a migration bridge, not a permanent foreign-key strategy.

The bridge must cover every entity needed by the task workflow, at minimum users, projects, boards, board columns, and tasks. Where comments, labels, dependencies, or activity records are imported, their source IDs should be retained too when a corresponding column is available.

## Why not reuse Mongo ObjectIds as PostgreSQL primary keys?

- The current JWT `sub` and API routes contain Mongo ObjectIds.
- PostgreSQL relationships use UUID foreign keys.
- Reusing ObjectIds as UUIDs is not a valid conversion and would break referential integrity.
- Keeping the mapping explicit lets us import records in dependency order and resolve old API IDs without weakening the relational schema.

## Required behavior for the first SQL task workflow

1. Authenticate using the current JWT only while the existing Mongo-backed auth middleware remains active.
2. Resolve `req.user.id` through `users.legacy_mongo_id`; fail closed if there is no mapped SQL user.
3. Resolve the route's Mongo project ID through `projects.legacy_mongo_id`; never treat an arbitrary client-supplied ID as authorization.
4. Check SQL project ownership/membership before task reads or writes.
5. Convert legacy project/task IDs to SQL UUIDs inside the service layer and convert UUIDs back to legacy IDs only at the compatibility boundary if the existing frontend contract requires it.
6. Do not write the same task to both databases. The SQL vertical slice must have one authoritative write path and must be opt-in until its integration tests pass.
7. Import users/projects/boards/columns before tasks. If a source record cannot be mapped, report it as a migration error rather than silently dropping or inventing a relationship.

## Cutover guardrails

- Keep MongoDB as the default runtime until the SQL workflow has integration tests for create, list, update, authorization failures, filters/pagination, and stale-version HTTP 409 behavior.
- Do not enable SQL task writes in production merely because the schema migration succeeds.
- Preserve a rollback path: the feature flag stays off by default, and deployment configuration must explicitly opt in to the SQL workflow.
- Before a full cutover, migrate and test every other Mongo-dependent feature (auth, project membership, comments/activity, dependencies, notifications, invitations, chat/realtime) or explicitly scope it out with evaluator approval.

## Known model mismatch to resolve

Mongo tasks currently reference `projectId` and a status enum, while the relational schema models tasks through `board_id` and `column_id`. Before importing tasks, establish a deterministic mapping from each project to a board and each Mongo task status to a board column. Do not assume a board or status mapping exists unless the source data confirms it.
