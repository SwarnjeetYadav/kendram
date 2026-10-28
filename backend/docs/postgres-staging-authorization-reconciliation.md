# PostgreSQL staging authorization and reconciliation review

**Scope:** feat/postgres-persistence staging branch, PR #16. This records compatibility checks and safe next steps. It is not production cutover approval.

## Authorization comparison

The existing MongoDB services in src/services/project.service.js, task.service.js, and dependency.service.js are the reference behavior for routes already exposed by MongoDB.

| Operation | Expected behavior | PostgreSQL staging coverage |
|---|---|---|
| Read project | Administrator, owner, or project member may read; non-member is denied | Project HTTP integration + mapping/authorization parity suite |
| List projects | Administrator sees all; other users see owned/member projects | Project HTTP integration |
| Read/list tasks | Administrator, owner, or project member may access | Task service and HTTP integration |
| Create/update tasks | Viewer membership is read-only; other authorized members may write | Task service and HTTP integration |
| Assign task | Assignee must be an active project member; viewers cannot be assigned | Task HTTP integration |
| Invalid task ID | Reject malformed ID with HTTP 400 | Task HTTP integration |
| Unmapped project ID | Return a clear not-migrated/not-found response, not a server error | Task and project mapping HTTP tests |
| Project membership management | Owner, administrator, or project manager may manage members; protect owner membership | Project HTTP integration |

The PostgreSQL-only project update/delete endpoints have no direct counterpart in the currently mounted MongoDB project.routes.js. Their owner/manager/admin policies should be treated as new API behavior, not proven one-to-one parity.

## Test and cleanup review

Run from PowerShell in backend/:

```powershell
npm run test:postgres
```

The suite includes schema constraints, task-service behavior, auth/task/project HTTP tests, and the project mapping/authorization parity suite. Integration fixtures use randomized test identities and remove their PostgreSQL project/user/activity rows in afterAll; they use an ephemeral MongoDB Memory Server. Do not point these tests at production. The tests run migrations before exercising PostgreSQL routes, so use only the intended staging/test DATABASE_URL.

Coverage explicitly includes malformed task IDs, missing task project mappings, malformed project IDs, valid-but-unmapped project IDs, owner access, administrator access, and non-member denial. Existing task tests also cover viewer write denial, stale-version conflicts, and unmapped PostgreSQL users.

The migration runner reads numbered SQL files from backend/database/migrations and records applied migration names in schema_migrations. Inspection of the runner and available migration list did not identify a migration that intentionally seeds the two stale user IDs or the missing project UUID. This does not prove how the records were originally created; the application membership service does emit the observed activity action names and creates a notification when adding a member.

## Read-only migration reconciliation

Run the preflight from backend/ against the same intended staging PostgreSQL database and approved test/development MongoDB source:

```powershell
npm run db:preflight:postgres -- .\\postgres-staging-verification-next.json
```

Use a new output filename each time because the report writer intentionally refuses to overwrite an existing report. The command issues MongoDB reads and PostgreSQL SELECTs only. It does not import, update, delete, create tables, or change feature flags.

The report checks:
- Every source user, project, task, dependency, and comment has a PostgreSQL row with the matching legacy_mongo_id.
- Target legacy IDs absent from the current source are surfaced for review.
- Mapped project owners, task project/creator/assignee relationships, and comment task/author relationships match the source IDs.
- Target foreign keys, task status columns, dependency edges, and duplicate legacy mappings are checked.
- Raw source/target count differences and target rows without legacy IDs remain warnings; they are not fixed by deleting seed/demo records.

## Known staging snapshot and decision

On 2026-10-27, the read-only report recorded 5 source users, 1 source project, 2 source tasks, 0 dependencies, and 1 comment. All source records had target legacy-ID mappings and no blockers were reported. The target also contains preserved synthetic rows without legacy IDs (3 users, 1 project, 4 tasks), so the count deltas and readyForImport: false are expected review warnings. **Keep these rows.** Do not force the readiness flag to true by deleting seed data or rerunning imports.

### Stale user mappings and orphaned audit references (2026-10-27)

A read-only investigation of the staging database identified two target user rows whose legacy MongoDB IDs are absent from the current MongoDB users collection:

| PostgreSQL user UUID | Legacy MongoDB ID | Target references observed |
|---|---|---|
| `56ddcac0-8bb6-4fd5-9277-d67694328ba5` | `6adfb6c9751c942989f75c45` | 1 notification |
| `78349e85-f8a8-463c-8d88-04335622e23f` | `6adfb6c9751c942989f75c44` | 3 activity-log rows |

The three activity rows are `PROJECT_MEMBER_ADDED`, `PROJECT_MEMBER_ROLE_UPDATED`, and `PROJECT_MEMBER_REMOVED`. They reference project UUID `688da7bb-50fa-4b6e-a869-e933d5d3dd70`; the notification is `PROJECT_MEMBER_ADDED` and its message names `Updated PostgreSQL project`. All four rows have timestamps clustered around 2026-10-27 01:53:37 +05:30.

Read-only checks confirmed:
- Neither legacy user ID currently exists in MongoDB; MongoDB activity-log and notification counts for those IDs are both zero.
- The project UUID is absent from PostgreSQL `projects` and `project_members`.
- A search of PostgreSQL `activity_logs`, `notifications`, `projects`, and `project_members` found the project UUID only in the three activity rows and one notification.
- The two SQL users have no references in the other checked user foreign-key columns. The references listed above are the exceptions.
- Repository inspection found a strong match with the PostgreSQL project HTTP integration test in `backend/src/tests/integration/postgresProjectHttp.integration.test.js`: it creates a project, renames it to the exact name `Updated PostgreSQL project`, adds a member with `VIEWER` permissions, changes the member to `MEMBER`, then removes the member. The test checks for the same `PROJECT_MEMBER_ADDED` notification and activity-log actions.
- The integration test uses randomized MongoDB Memory Server user IDs and its cleanup is intended to delete the project, test-owned activity rows, and synthetic users. This explains why the legacy Mongo IDs are not in the current persistent MongoDB collection: an ephemeral test MongoDB is not retained after the test process exits.
- Follow-up read-only inspection of `public.users` confirmed the SQL rows use the exact test naming patterns and the same randomized suffix, `4d574550-b91f-4e26-9774-f78ac432f63a`: owner `pg-project-owner-4d574550-b91f-4e26-9774-f78ac432f63a@example.test` and viewer `pg-project-viewer-4d574550-b91f-4e26-9774-f78ac432f63a@example.test`. Their creation timestamps are 2026-10-26 20:23:37.445 UTC and 20:23:37.512 UTC, respectively, matching the same event cluster as the orphaned audit/notification rows.
- The integration test's `afterAll` cleanup is intended to delete activity rows by test-user email and then delete those users; the viewer notification should also be removed by the user FK's cascade. Since the users and related rows remain, the exact run's cleanup likely did not complete successfully or the rows were otherwise retained after the test workflow. The current evidence does not identify the precise failure. The migration runner and numbered schema migrations reviewed do not seed these specific IDs.

**Disposition: very likely PostgreSQL project integration-test residue; cleanup failure or interruption remains unproven.** The shared randomized suffix, exact test email patterns, matching project name, matching membership action sequence, and matching timestamps form a strong combined correlation. Preserve both user rows and all four activity/notification records until database logs or a known-good snapshot can establish whether cleanup failed and whether any additional references exist. Do not delete or rewrite mappings, rerun imports, or remove seed/demo rows to make the preflight green. If logs/snapshots are unavailable, document the origin as high-confidence but not conclusively proven, and seek explicit approval for any later reconciliation plan.

The stale mapping checks remain warnings until the history is understood and a documented reconciliation decision is approved. A clean report is still not cutover approval: authoritative reconciliation needs a coordinated source snapshot/maintenance window and an explicit rollback plan.

## Guardrails

- Keep PR #16 as a draft.
- Keep POSTGRES_AUTH_ENABLED, POSTGRES_PROJECTS_ENABLED, POSTGRES_TASKS_ENABLED, and VITE_POSTGRES_API_ENABLED disabled in production.
- Do not create another database, rerun imports, or delete preserved seed records as part of this review.
