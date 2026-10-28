# Architecture decisions and known limitations

## Decision 1 — Existing stack retained for the current branch

- Frontend: React + Vite.
- API: Node.js + Express REST endpoints.
- Persistence: MongoDB with Mongoose.
- Authentication: JWT bearer tokens; password hashing uses bcrypt.
- Realtime collaboration: Socket.IO.
- Deployment: Vercel/Render for hosted environments; Docker Compose for local self-hosting.

### Rationale
This preserves the existing working Kendram code and avoids a risky wholesale rewrite before the internship evaluator confirms whether the relational database requirement is strict.

### Known limitation
The assignment specifically requests a relational schema. MongoDB/Mongoose is not relational. The current application must not be represented as satisfying that exact requirement until a relational adapter/migration is implemented or the mentor explicitly accepts the existing data store.

## Decision 2 — Optimistic task concurrency

Each task has a monotonically increasing version. Task writes use a compare-and-swap filter, so only one update based on a given version succeeds. Stale writes return HTTP 409 and ask the client to refresh and retry. Clients should send the version returned with the task to detect stale views.

## Decision 3 — Paginated task listings

Task listing accepts bounded pagination (page, limit), status, priority, assignee (including unassigned), label and due-date range filters. A pagination metadata object is returned alongside the existing task array.

## Known limitations / validation still required

- Browser drag-and-drop should be tested to confirm it sends task versions and reverts optimistic UI state on HTTP 409.
- Backend coverage must be measured in CI; a target is not evidence of achieved coverage.
- Load-test latency under 300 ms with 1,000 seeded tasks must be measured in the target environment.
- OpenAPI describes the REST contract; it does not prove every endpoint is contract-tested.
- Docker Compose is a local development/self-hosting convenience, not a production secrets configuration.


## Decision 3 — PostgreSQL migration plan (in progress)

The YuvaIntern rubric calls for relational persistence and explicit board/column entities. The current runtime uses Mongoose ObjectIds across authentication, projects, tasks, comments, activity, dependencies, notifications, invitations and chat. Replacing only the database connection or adding a PostgreSQL dependency would not migrate those data-access paths and would leave the application in a misleading mixed state.

### Migration sequence

1. **Establish the relational runtime foundation:** PostgreSQL connection configuration, schema migrations, deterministic seed data, health checks and test-database setup. Keep MongoDB as the default until the relational path is tested.
2. **Model the rubric's core relational entities:** users, teams/team memberships, boards, board columns, tasks, comments and activity history, with foreign keys, unique constraints, indexes and explicit column ordering.
3. **Move core API workflows as a vertical slice:** create/list/update tasks, board/column ordering, comments and activity history; preserve authorization, validation, task version conflict behavior, filtering and pagination.
4. **Add integration and acceptance tests against PostgreSQL:** verify foreign-key enforcement, rollback behavior, concurrency conflicts, unassigned and overdue tasks, and access-control failures.
5. **Migrate adjacent features and deployment configuration:** project membership, dependencies, notifications, invitations, authentication/email verification and chat/realtime persistence. Do not remove MongoDB until each feature has an equivalent tested SQL implementation or an explicit documented reason to remain separate.
6. **Switch local evaluation and deployment configuration only after validation:** Docker Compose should run the selected runtime database; update environment examples and setup documentation without committing credentials.
7. **Run the 1,000-task benchmark after the database path is stable:** record dataset size, environment, request mix, number of samples, p50 and p95; compare p95 with the rubric's under-300 ms target.

### Safety and completion criteria

- Work on a feature branch and keep `main` unchanged until reviewed and merged.
- Do not claim SQL persistence based only on a schema file or a successful PostgreSQL connection.
- Do not delete the MongoDB path until core and adjacent feature tests pass on PostgreSQL.
- Mark the relational requirement complete only when the running API actually reads and writes the required entities in PostgreSQL and automated tests prove the relationships and constraints.
- Mark the performance target complete only after a reproducible run with at least 1,000 tasks produces recorded latency evidence.
