# PostgreSQL route parity audit

Branch: `feat/postgres-persistence`. This is a source-level scope audit, not a declaration of production readiness. The MongoDB routes remain the default in `backend/src/routes/index.js`; PostgreSQL routes are opt-in under `/api/v1/postgres` when `POSTGRES_PROJECTS_ENABLED=true`, while task routes additionally require `POSTGRES_TASKS_ENABLED=true`.

## Route inventory

| Capability | MongoDB/default route | PostgreSQL opt-in counterpart | Audit status |
|---|---|---|---|
| Authentication, registration, verification, login, password reset | `/auth/*` | PostgreSQL auth behavior is feature-controlled within auth services; no parallel namespace in the route index | Partial; inspect every auth flow and email provider in dedicated tests |
| Projects CRUD | `/projects`, `/projects/:projectId` | `/postgres/projects`, `/postgres/projects/:projectId` | Integration coverage exists for project mapping and CRUD; full response/permission parity still needs review |
| Team membership/roles | `/projects/:projectId/members*` | `/postgres/projects/:projectId/members*` | Add/remove/role tests exist; cross-mode authorization parity and realtime revocation now have unit coverage, but test run for latest commit is required |
| Tasks CRUD/list/filter/pagination | `/tasks/project/:projectId`, `/tasks/:taskId` | `/postgres/tasks/project/:projectId`, `/postgres/tasks/:taskId` | PostgreSQL route tests cover core cases; verify all filters, DTO shapes, conflict status, and role matrix |
| Task dependencies/blockers/activity/comments | `/tasks/:taskId/dependencies*`, `/tasks/:taskId/blockers`, `/tasks/:taskId/activity`, `/comments/tasks/:taskId/comments` | PostgreSQL task routes include dependency, blocker, activity and task-scoped comment endpoints | Partial; Mongo comment URL shape differs from PostgreSQL task-scoped URL; compare frontend API callers and exact response semantics |
| Project chat and reactions | `/projects/:projectId/chat*` | `/postgres/projects/:projectId/chat*` | Unit tests cover Socket.IO auth/room isolation/revocation/reconnect. Live two-browser and PostgreSQL-backed end-to-end checks remain pending |
| Activity | `/activity`, `/projects/:projectId/activity`, `/tasks/:taskId/activity` | `/postgres/activity`, `/postgres/projects/:projectId/activity`, task activity under PostgreSQL task routes | Partial; verify pagination, filters, IDs and event model mapping |
| Notifications | `/notifications`, `/notifications/:id/read` | `/postgres/notifications` and `/postgres/notifications/:id/read` | Partial; run ownership and unread/read parity cases |
| Dashboard and analytics/insights | `/dashboard/summary`, `/projects/:projectId/analytics`, `/projects/:projectId/insights` | `/postgres/dashboard/summary`, `/postgres/projects/:projectId/analytics`, `/postgres/projects/:projectId/insights` | Query concurrency fix verified locally in integration suite; business metric parity still needs fixture-by-fixture comparison |
| Search | `/search` | `/postgres/search` | Partial; compare scope/filter and result DTO semantics |
| Invitations | `/projects/:projectId/invitations`, `/invitations`, `/invitations/:id` | `/postgres/invitations/project/:projectId`, `/postgres/invitations/mine`, `/postgres/invitations/:id` | Partial; route shapes differ and must be reconciled with frontend consumers |
| Preferences/settings | `/settings/preferences` | `/postgres/settings/preferences` | Partial; verify field-level validation and persistence parity |
| Labels | No separate mounted Mongo label router identified in the route index; labels may be task payload/embedded behavior | `/postgres/projects/:projectId/labels*` | No parity claim; establish Mongo model/API semantics before treating this as equivalent |
| User profile | Auth/profile handling needs source-level inventory | No explicit PostgreSQL profile route in the route index | Gap to verify; do not claim parity until endpoint and schema are identified |
| Team reports/analytics, assignment suggestions | Project/task advanced routes | PostgreSQL workspace and project-member/task suggestion endpoints | Partial; compare scoring, authorization, output shape, and fallback behavior |
| Realtime transport | Socket.IO attached in `server.js` | Same transport with PostgreSQL auth/project authorization flags | Unit-level checks only; multi-instance fan-out and real-browser acceptance remain pending |

## Mandatory checks before enabling PostgreSQL globally

- For each row, inspect the frontend API caller and compare status codes, validation, response DTOs, pagination, and errors.
- Confirm owner, administrator, project manager, member, and viewer permissions for read/write routes.
- Confirm PostgreSQL auth/project IDs map consistently to legacy Mongo IDs.
- Verify that disabling either flag leaves the MongoDB route behavior unchanged.
- Run the full backend and frontend test suites against an explicitly isolated disposable test database.
- Exercise rollback/recovery and repeatable migration reconciliation before any cutover.
- Keep PR #16 in Draft; do not seed or import real data without explicit approval.

This inventory intentionally records unknowns as partial/gaps instead of assuming parity from green CI.


## Verified notification preference behavior

- **Chat mentions:** the PostgreSQL project HTTP integration test covers a disabled `preferences.notifications.chatMention` setting (message and mention still persist; notification count does not increase) and re-enabled behavior (notification is created). The user reported this test passed locally on commit `4a7215e`; it is part of the test file on the current branch.
- **Invitation creation:** the PostgreSQL project HTTP integration test verifies that a disabled invitee `preferences.notifications.projectInvitation` preference suppresses the `PROJECT_INVITATION` notification while the invitation itself is still created.
- **Invitation acceptance:** a regression assertion verifies that the inviter's disabled `projectInvitation` preference suppresses the `PROJECT_INVITATION_ACCEPTED` notification. The developer reported `npm run test:postgres` passing on commit `10b0476`, which includes this assertion. Latest-head CI confirmation remains a separate gate.
- These checks cover notification preference behavior only. They do not establish full API/route parity.

## Remaining acceptance gates

- Route names and response contracts differ in several areas (notably invitations, comments, notifications, activity, search and settings). Compare the actual frontend callers and equivalent MongoDB/PostgreSQL fixtures before claiming parity.
- Unit/integration tests are not a substitute for the documented two-browser Socket.IO acceptance checks. Those checks require an isolated environment and a real browser/API session.
- The migration runbook documents guarded dry-run account inventory and staging-only import controls; it does not prove a full application rollback or backup/restore rehearsal. Do not run importers, seed scripts, or destructive database operations as routine validation.
- Keep MongoDB as the default/production source of truth and keep all PostgreSQL feature flags disabled by default. PR #16 remains Draft.


## Status update — 28 October 2026

- The developer reported the local PostgreSQL, unit, and integration suites passing on commit 10b0476 (63 Vitest tests total plus PostgreSQL schema/task-service checks). These are reported results and must not be described as tests run by this documentation update.
- Commit c44afd2 contains the PostgreSQL analytics query-concurrency fix. Its warning is not considered closed until the latest branch head passes a trace-enabled reproduction and focused/full regression tests.
- A separate execution status and safety procedure is now tracked in backend/docs/postgres-migration-execution-status.md and linked from README.md.
- The following remain open: frontend route-caller inventory and DTO/error parity; full role matrix; live two-browser Socket.IO acceptance; disposable backup/restore and rollback rehearsal; and latest-head CI confirmation.
- Safety remains unchanged: PR #16 stays Draft/unmerged, MongoDB remains production/default, PostgreSQL flags stay disabled by default, and no routine seeding/import/destructive recovery is permitted for Kendram_db or kendram_pg_dev_test.


## Frontend route adapter trace — 28 October 2026

- `frontend/src/lib/api.js` was inspected against the backend route mounts. Project invitation paths are rewritten to `/postgres/invitations/project/:projectId`, inbox listing to `/postgres/invitations/mine`, invitation responses to `/postgres/invitations/:invitationId`, and task comments to `/postgres/tasks/:taskId/comments` when `VITE_POSTGRES_API_ENABLED=true`.
- Fixed the Vite environment variable mismatch in commit `3794db2`: API base configuration now reads `import.meta.env.VITE_API_BASE_URL`, matching the documented Vite deployment variable. The prior `API_BASE_URL` name is not exposed by Vite unless explicitly configured.
- Important gate: task routes are mounted only when `POSTGRES_TASKS_ENABLED=true`, separately from `POSTGRES_PROJECTS_ENABLED`; turning on only the frontend switch or projects flag is insufficient. Keep the frontend switch disabled outside isolated testing until this is configured intentionally.
- This update is source-level tracing, not a completed build or live request test. The full route DTO/status/error/pagination comparison and auth/profile migration scope remain open.


## Frontend verification evidence — 28 October 2026

- The developer's latest local checkout passed the focused route adapter suite (7/7) and Vite production build.
- After reducing Playwright concurrency to three local workers/two CI workers, the developer reran the browser suite and all 6 tests passed, including the previously intermittent Team view member-search/invitation/chat test.
- This is route-helper and frontend UI evidence only. It does not close the API parity table above: endpoint existence, auth and permission semantics, request/response DTOs, pagination, validation/error status parity, PostgreSQL database execution, and cross-user behavior still require backend-focused verification.
- The frontend switch remains opt-in and should not be enabled in production. In particular, the frontend currently routes all supported families together under one switch while backend project-family and task-family endpoints are gated separately; an isolated test must enable the matching backend flags as a set, and auth/profile remains on the existing `/auth/*` routes.

## Latest GitHub CI observation — 28 October 2026

- GitHub Actions reports `TeamFlow CI` run #577 completed successfully for commit `f53cff70d897fecf01c4014d5a2eda750b6494d1` (run ID `40576702099`). This confirms that workflow run only; it does not establish PostgreSQL runtime parity or close any of the permission/DTO/recovery gates above.
- The combined commit status also reports Vercel failure with the build-rate-limit/upgrade URL. This is recorded as a deployment-platform limit, not misreported as an application test failure or successful deployment.
- Next backend work remains the endpoint-by-endpoint authorization and response contract comparison, with focused tests for any discovered mismatch. MongoDB remains default and PostgreSQL flags remain opt-in.

## Task activity response parity fix — 28 October 2026

- Source review found the PostgreSQL task activity endpoint returned only a simplified activity-history array, while the MongoDB `/tasks/:taskId/activity` endpoint returns a merged event stream with `id`, `type`, `action`, `message`, `metadata`, `user`, and `createdAt`, including both audit activity and comments.
- Commit `b979a5a` updates PostgreSQL task activity to return the same event-stream shape, combines activity-history and comment records, sorts chronologically, and retains the existing 150-event response cap. Commit `3a7550d` adds PostgreSQL HTTP integration assertions for task-created events and both activity/comment representations of comments.
- The expected contract is now covered in source tests, but it is **not marked verified** until the PostgreSQL HTTP integration suite runs against the isolated test database on the latest commit. This change does not close the broader authorization, DTO, invitation, or recovery gates.

## CI correction note — 28 October 2026

The first CI run after adding task-activity contract assertions failed while loading the integration test module because the new assertion duplicated the existing `taskActivity` declaration. Commit `50d359d` corrects the variable name. The contract change remains unverified until CI and the PostgreSQL HTTP integration test complete successfully on the corrected commit.

Follow-up from CI run #586: the first activity-shape assertion revealed the new PostgreSQL formatter used generic lowercase action text (`task created`) rather than the exact MongoDB-compatible display text (`created the task`). Commit `f66eb63` adds the same action-to-message mapping used by the Mongo task activity controller. CI and PostgreSQL HTTP integration must pass on this follow-up before this parity fix is closed.

Follow-up from CI run #590: the activity assertion confirmed that PostgreSQL comments write their `COMMENT_ADDED` audit entry to `activity_logs`, not `activity_history`. The feed initially merged `activity_history` and comments but therefore omitted the activity-form comment event. Commit `84cf3ee` adds the task-scoped `activity_logs` records to the combined feed. The focused PostgreSQL integration assertions and full CI must pass on this commit before declaring the response contract verified.


### Invitation response DTO compatibility — 28 October 2026

The PostgreSQL invitation service now returns Mongo-compatible nested `projectId`, `invitedUserId`, and `invitedBy` objects (including user role/email fields where available), while retaining flattened aliases for existing PostgreSQL consumers. Project status is included when present for inbox views. This is a source-level compatibility adjustment; invitation HTTP regression coverage and frontend runtime verification are still required before marking invitation parity complete.


### Invitation DTO CI correction — 28 October 2026

CI run #598 caught an outdated integration assertion that expected `invitedUserId` to remain a scalar after the PostgreSQL DTO was aligned with MongoDB's populated nested reference. Commit `7a15938` updates the create/list assertions to check the nested `_id` and user fields. This corrects the test contract; the new commit still requires CI verification. Invitation parity remains partial.


### Invitation validation and error parity follow-up — 28 October 2026

Commits `b56a1a4` and `e74ec87` align PostgreSQL invitation handling more closely with the Mongo API: malformed PostgreSQL invitation UUIDs and unsupported actions now return 400, malformed invitee legacy IDs are covered by HTTP assertions, missing/inactive invitees return 404 rather than the actor-account mapping error, and the manager permission message matches the existing route's wording. Expiry and role-matrix parity remain open until dedicated regression cases and CI evidence confirm behavior.

Invitation expiry coverage: commit `403b7ef` adds an HTTP integration scenario that backdates a pending invitation in the isolated test database, attempts acceptance, expects 409, and asserts the status persists as `EXPIRED`. This test is awaiting CI confirmation and does not use a developer or production database.


### Notification ownership regression — 28 October 2026

Commit `3d4824b` extends the PostgreSQL project HTTP integration flow to take an invitation-accepted notification owned by the project owner and assert that a different authenticated user cannot mark it read (expected 404). This verifies ownership enforcement for the exercised endpoint; complete notification pagination/unread semantics and broader permission parity remain open.

Notification read semantics follow-up: commit `ffab226` extends the same isolated HTTP flow to verify that the owner can mark their notification read and repeat the operation without changing the original `readAt` timestamp. Await CI confirmation; unread counters, pagination, and full DTO parity remain open.

Member-role authorization follow-up: commit `b3568a2` adds an HTTP regression check that a non-manager cannot change a project's member role. It accepts the existing forbidden/not-accessible response distinction (403/404) because project visibility is intentionally hidden for non-members. Await CI confirmation on the latest head.


### Workspace/settings contract coverage — 28 October 2026

Commit `4ae8d37` adds HTTP assertions to the isolated PostgreSQL project integration suite for preference defaults, invalid boolean rejection, partial preference updates with preservation of other defaults, persistence across reads, dashboard summary numeric fields, and project-scoped search returning the created fixture. This improves endpoint contract coverage but does not prove full MongoDB semantic parity or analytics/insights equivalence; latest CI must pass before closing even this focused coverage item.

Task permission follow-up: commit `f7e3440` adds an HTTP assertion that a viewer can comment but cannot update the task itself (expected 403), clarifying the intended read-only role boundary. Await CI confirmation on the latest commit.

CI correction: run #627 found a duplicate `dashboard` declaration in the expanded project HTTP test (the suite already had a dashboard assertion later in the same test). Commit `848e756` renames the new variable to `dashboardAfterProjectUpdate`; the fix requires CI confirmation on the latest head.

CI correction follow-up: run #635 exposed a second duplicate binding (`search`) in the same integration test because project-search assertions already existed later in the test. Commit `e65eb28` renames the new variable to `projectSearch`; latest CI must pass before this coverage can be counted as verified.

Search assertion correction: run #639 showed that PostgreSQL workspace search returns normalized results with `type` and `title`, not a `name` field. Commit `79fbe0e` updates the new assertion to the actual route contract while keeping the project result scoped. CI must pass on the latest head before the added workspace coverage is considered verified.

Settings test isolation correction: run #646 reached the settings assertions but a new preference mutation occurred before an existing default-value assertion in the same shared fixture. Commit `319a160` moves the new settings validation/persistence assertions after the existing default check, so the test no longer contaminates that earlier expectation. Await CI on the latest head.


### Authentication boundary and verification expiry — 28 October 2026

Commit `04778d8` adds PostgreSQL auth HTTP integration coverage proving an expired email-verification token returns 400 and does not mark the account verified. The existing suite also covers unverified login denial, successful verification/login, profile persistence, reset-token single use, and invalid bearer tokens. This covers the opt-in PostgreSQL auth flow with synthetic accounts; it does not authorize enabling `POSTGRES_AUTH_ENABLED` in production or establish mail-provider delivery in a deployed environment.

Auth test isolation correction: CI run #654 showed the expired-verification scenario changed the shared account used by the password-reset test. Commit `353b0ab` now uses a dedicated synthetic user for the expired token and deletes that fixture after the assertion. This prevents cross-test state contamination; latest CI confirmation is pending.


### PostgreSQL realtime room authorization — 28 October 2026

Commit `2da11cf` adds a Socket.IO unit integration case where the PostgreSQL-backed project membership check rejects a room join. The test asserts the client receives a denial acknowledgement and that the PostgreSQL project-access lookup was used. Existing Socket.IO tests cover two-room message/reaction isolation, leaving rooms, membership revocation, reconnect/rejoin, and PostgreSQL-backed join authorization. These are in-process Socket.IO tests, not a real-browser deployed-stack acceptance run.


### Local test evidence — 28 October 2026

After pulling `068aac8`, the owner reported: unit suite 20/20 passing; general integration suite 28/28 passing; PostgreSQL schema/task checks passing; PostgreSQL HTTP integration suite 18/18 passing. These results support the exercised flows but do not close the full route/role/DTO parity audit. Remaining gates include role-by-role coverage for all project/member/task mutations, complete dashboard/search/settings response comparison, browser acceptance for two-client PostgreSQL chat, and staging-only reconciliation/recovery evidence.


### Identifier validation parity — 28 October 2026

- PostgreSQL notification-read now rejects malformed notification IDs with HTTP 400, matching the MongoDB controller's invalid-ID response rather than falling through to 404.
- PostgreSQL task comment list/create now reject malformed task identifiers with HTTP 400 while retaining support for legacy Mongo ObjectIds and PostgreSQL UUIDs.
- Regression assertions are present in the PostgreSQL project/task HTTP integration tests. Verification is pending on the latest branch head; do not close this gate until `npm run test:postgres` passes.
