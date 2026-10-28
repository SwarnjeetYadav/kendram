# Junior Software Developer Internship

## Project

**Kendram - Smart Task Management and Collaboration Platform**

This repository records the weekly internship documentation and the actual Kendram project build.

## Internship

- Organization: YuvaIntern
- Role: Junior Software Developer Intern
- Mode: Remote
- Duration: 6 weeks
- Start Date: 29 September 2026
- End Date: 10 November 2026

## Project Status

**Six-week documentation completed; advanced workspace implementation, testing, deployment configuration and production hardening are in place.**

## Deployment Architecture

```text
Browser
   |
   v
Vercel / React Frontend
   |
   | HTTPS REST API
   v
Render / Node + Express Backend
   |
   v
MongoDB Atlas
```

### Frontend deployment

Use the `frontend` directory as the Vercel project root.

Build command: `npm run build`

Output directory: `dist`

Set:
`VITE_API_BASE_URL=https://<your-backend-domain>/api/v1`

Current frontend deployment:
`https://anvaya-git-main-swarnjeets-projects.vercel.app/`

`frontend/vercel.json` provides the SPA fallback for client-side routes such as `/projects`, `/team`, `/reports` and `/settings`.

### Backend deployment

The repository includes `render.yaml` for a Render web service.

Required production environment variables:

- `NODE_ENV=production`
- `MONGODB_URI=<MongoDB Atlas connection string>`
- `JWT_SECRET=<random secret of at least 32 characters>`
- `CLIENT_ORIGINS=https://anvaya-git-main-swarnjeets-projects.vercel.app`

Never commit real credentials.

## Production Hardening

The backend now includes:

- Helmet security headers.
- Explicit CORS origin allow-listing.
- Authentication rate limiting.
- JSON request size limiting.
- Disabled Express `X-Powered-By`.
- Production proxy awareness.
- Strong JWT secret validation in production.
- Structured HTTP request timing logs.
- Graceful SIGTERM/SIGINT shutdown.
- Health endpoint with timestamp and process uptime.
- Centralized safe error responses.

## Testing

GitHub Actions validates backend unit tests, backend API integration tests, frontend production build, and Chromium browser regression tests.

## Weekly Progress

| Week | Focus | Status |
|---|---|---|
| Week 1 | Project Planning and Requirements Analysis | Completed |
| Week 2 | Design Documentation and Architecture Planning | Completed |
| Week 3 | Feature Development and Code Prototype Documentation | Completed |
| Week 4 | Software Testing and QA Planning | Completed |
| Week 5 | Code Debugging Refactoring and Technical Analysis | Completed |
| Week 6 | Final Project Integration Reflection and Future Roadmap | Completed |

## Application Build

### Frontend

- Responsive Kendram workspace
- Live authenticated workspace loading
- Live project listing and creation
- Project-aware live task creation
- Live task filtering
- Live task updates
- Live task comments
- Live project progress and member counts
- Live team workload aggregation
- Live project team management, member roles, removal, invitations, and project chat
- Live project member search and add flow
- Notifications with user preferences
- Activity feed
- Demo mode
- Playwright regression suite

### Backend

- JWT authentication
- Role based access
- Projects and membership
- Tasks and explainable Smart Assignment 2.0
- Kanban board, list, calendar and timeline views
- Task dependencies with cycle prevention and blocker notifications
- Project analytics and Kendram Insights
- Permission-aware global search / Ctrl+K command palette
- Project invitations and onboarding
- Activity logging
- Notifications
- Dashboard summary
- Centralized errors
- Vitest unit tests
- Disposable MongoDB integration tests
- Production security middleware

## Current User Journey

Login -> Workspace -> Projects -> Create Project -> Create Task -> Smart Assignment -> Task Details -> Status/Priority/Assignee/Due Update -> Comment -> Activity -> Notification -> Team Member Management

See `DEVELOPMENT-LOG.md` for the implementation history.


## Advanced Workspace

The current Kendram workspace follows the advanced product specification:

- **Project views:** Overview, Board, List, Calendar, Timeline, Activity.
- **Smart Assignment 2.0:** top-three explainable recommendations based on workload, due-date fit, project role, priority load and availability.
- **Dependencies:** predecessor/successor links, circular-chain prevention, blocker enforcement and dependency-unblocked notifications.
- **Collaboration:** floating project chat with unread state, fullscreen mode, replies, mentions, reactions and task context support.
- **Team administration:** project-scoped Project Manager, Team Member and Viewer permissions, member add/remove/role changes and seven-day invitations.
- **Intelligence:** live completion, overdue, blocked, cycle-time, throughput and workload analytics plus rule-based project health signals.
- **Search:** permission-aware global search with Ctrl/Cmd+K command palette.
- **Settings:** notification preferences and workspace display density.
- **Quality:** unit/integration coverage and Playwright regression coverage for the advanced workspace.

The advanced implementation intentionally keeps secondary features inside project/work surfaces so the global navigation remains focused.


## Email verification and password recovery

- New signups receive an email verification link and cannot sign in until the address is verified.
- Verification links expire after 30 minutes; users can request a replacement verification email.
- Forgot-password requests use a generic response to avoid revealing whether an email is registered.
- Password reset links expire after 30 minutes and are single-use.
- Verification/reset tokens use cryptographically secure random values; only SHA-256 token hashes and expiry timestamps are stored.
- Passwords continue to be hashed with bcrypt. Reset tokens are cleared after use.
- Email delivery uses the Resend HTTP API. Configure `APP_URL`, `RESEND_API_KEY`, and `EMAIL_FROM` in backend environment settings. Never commit API keys.
- Legacy user records retain the schema default `emailVerified: true`; new registrations explicitly start unverified.

### Configure email delivery

1. Create a Resend account and obtain an API key.
2. Verify the sender domain in Resend for production delivery.
3. Set `APP_URL` to the deployed Kendram frontend origin (for example, your Vercel URL).
4. Set `RESEND_API_KEY` and `EMAIL_FROM` in Render's backend environment variables. The sender must be permitted by your Resend account.
5. For local testing, set the same variables in `backend/.env`. Do not commit that file.
6. Test registration, email verification, blocked login before verification, resend verification, forgot password, expired/invalid links, and successful single-use password reset.

The email endpoints are covered by the existing authentication rate limiter. If the email provider is not configured, email operations return a configuration error instead of pretending an email was sent.


## YuvaIntern Team Task Board brief alignment

The existing Kendram codebase is being extended against the Team Task Board Web Application rubric. The project remains named Kendram; this section records the overlap and does not imply every rubric item has been independently accepted by the evaluator.

### Task API improvements on this branch

- Task labels are validated (up to 20 unique labels, each up to 32 characters).
- Task updates use a monotonically increasing version and an atomic compare-and-swap write. A stale update returns HTTP 409 Conflict.
- Kanban drag-and-drop applies an optimistic local status change and rolls it back if the API rejects the move.
- Task listing supports page/limit (limit max 100), status, priority, assigneeId (or unassigned), label, dueDateFrom, dueDateTo and overdue=true filters.
- The task-list response retains the data array and adds meta.pagination (page, limit, total, pages, hasNextPage, hasPreviousPage).

Example requests:

    GET /api/v1/tasks/project/:projectId?page=1&limit=25&assigneeId=unassigned
    GET /api/v1/tasks/project/:projectId?label=backend&dueDateFrom=2026-10-01&dueDateTo=2026-11-01
    PATCH /api/v1/tasks/:taskId
    { "status": "IN_PROGRESS", "version": 3 }

When two requests attempt to update the same task version, only one should succeed. The other receives 409 and the client should reload current task state.

### Rubric documentation

- OpenAPI contract: openapi.yaml
- Logical data relationship diagram: docs/kanban-database-diagram.md
- Normalized PostgreSQL schema and seed data: database/postgres-schema.sql
- Architecture choices and known limitations: docs/architecture-decisions.md
- Rubric-aligned test plan: docs/test-plan.md
- Requirement tracking and evidence gaps: docs/known-limitations.md

### Run locally with Docker Compose

Requirements: Docker Desktop / Docker Engine with the Compose plugin.

    docker compose up --build

- Frontend: http://localhost:8080
- API health: http://localhost:5000/api/v1/health
- MongoDB data persists in the kendram_mongo_data volume.
- Stop services with: docker compose down
- To remove local database data too: docker compose down -v

The Compose file is for local evaluation and self-hosting. Change the default JWT secret and configure production email credentials before any non-local deployment. The frontend API URL is compiled into the frontend image; set the build argument VITE_API_BASE_URL for a different deployment topology.

### Important rubric caveat

The YuvaIntern brief specifically asks for a relational schema and explicit boards/columns. Kendram currently uses MongoDB/Mongoose and represents workflow columns through task status. A normalized PostgreSQL reference schema and realistic 15-person seed dataset are also provided in database/postgres-schema.sql. This meets the relational design artifact portion, but the deployed application still persists to MongoDB; the SQL schema is not wired into the runtime API. If the mentor requires SQL as the live database, a migration and repository/transaction adapter remain required.

### Verification policy

Do not claim the 80% backend coverage target or sub-300 ms performance target has been met until CI coverage output and a repeatable 1,000-task load test have been run and recorded. See docs/test-plan.md.


### Latest Kanban-compliance CI status

The first CI run for the rubric branch passed the backend unit tests, all 12 integration tests (including 3 new Kanban acceptance tests), and the frontend build/Playwright suite. The generated coverage baseline was **61.4% statements / 49.12% branches / 60.76% functions / 71.35% lines**, so the rubric's 80% backend coverage requirement is **not yet met**. The CI workflow now also builds the Docker Compose images; check the latest run before treating that build as verified.

Performance is not claimed as passing yet. Run scripts/benchmark-task-list.mjs against a disposable project containing at least 1,000 tasks and save the output with the submission evidence.


## PostgreSQL migration status

The PostgreSQL work on feat/postgres-persistence is a development/testing slice, **not production-ready**. PR #16 must remain Draft and unmerged. MongoDB remains the production/default source of truth; PostgreSQL feature flags remain disabled by default.

The developer reported these local checks passing on commit 10b0476: npm run test:postgres, npm test, and npm run test:integration (63 Vitest tests total, plus PostgreSQL schema/task-service checks). Migrations 001–004 were already applied locally; this is not a fresh-database migration rehearsal. Commit c44afd2 contains an analytics query-concurrency fix that still needs verification on the latest branch head.

**Outstanding gates:** frontend/API route and response parity; authorization parity across owner/admin/project manager/member/viewer; two-browser live chat delivery/isolation/removal/reconnect checks; disposable-environment backup/restore and rollback rehearsal; latest-head GitHub Actions; and non-production email plus multi-instance realtime validation where applicable. Do not seed Kendram_db or kendram_pg_dev_test, import real data, or run destructive recovery operations as routine validation.

See backend/docs/postgres-migration-execution-status.md for the evidence baseline, exact outstanding gates, and safe validation procedure. Also see backend/docs/postgres-route-parity-audit.md and backend/docs/postgres-and-chat-acceptance-checklist.md. Update these docs after each implementation or verification change; do not mark a gate complete without reproducible evidence.


### Latest frontend/API trace update

- Fixed `frontend/src/lib/api.js` to read `VITE_API_BASE_URL` (Vite-exposed variable) instead of `API_BASE_URL`. Commit: `3794db2`.
- Source inspection confirmed that project invitation and task-comment paths are rewritten to the corresponding PostgreSQL route namespaces when `VITE_POSTGRES_API_ENABLED=true`. This is source-level verification only; frontend build/live HTTP parity still needs test evidence.
- Note: PostgreSQL task routes additionally require `POSTGRES_TASKS_ENABLED=true`; the client switch alone does not enable the backend route. Keep the frontend switch off in production until both route gates, auth/profile behavior, and response parity have been verified.


### Frontend route test coverage added — 28 October 2026

The PostgreSQL API route mapper has been extracted to `frontend/src/lib/apiRoutes.js` and now has focused, dependency-free tests in `frontend/src/lib/apiRoutes.test.js`. Run `npm run test:routes` from `frontend/` to verify route selection for default MongoDB mode and opt-in PostgreSQL project, invitation, task, comment, settings, dashboard, search, activity, and notification paths. This test command has been added to package.json but has not yet been executed in this GitHub editing session; run it locally and confirm CI before treating it as passing.

Local `.env` clarification: `POSTGRES_TASKS_ENABLED=true` only mounts the backend `/api/v1/postgres/tasks/*` endpoints after restarting the backend. It does not turn on frontend routing or mount the other PostgreSQL endpoints. In isolated local testing only, task requests through the frontend additionally need `VITE_POSTGRES_API_ENABLED=true`, and project/invitation/chat/settings/notification routes require `POSTGRES_PROJECTS_ENABLED=true`. Do not enable the frontend switch on a shared or production deployment until auth/profile and all route contracts are validated. MongoDB remains the default/production source of truth.


### Route adapter flag wiring fix — 28 October 2026

The frontend API request wrapper now explicitly passes `VITE_POSTGRES_API_ENABLED` into the pure route mapper (commit `17595bc`). Without that argument, the helper's safe default would keep all requests on MongoDB routes even when the frontend opt-in flag was set. A local report found that `npm run test:routes` was not available in the developer's checkout while `npm run build` passed; the script is present on the remote `feat/postgres-persistence` branch. Update the local checkout to the latest branch head, then run `npm run test:routes` and `npm run build` from `frontend/`. These checks are pending on the latest head; this note does not claim CI or runtime route parity is verified.


### Frontend verification update — 28 October 2026

The developer reports `npm run test:routes` passing (7/7), `npm run build` passing (Vite 8.3.3), and the second local Playwright run passing (6/6). The first Playwright run had one 30-second timeout in the live Team-view member-search test; this is recorded as a possible flake, not considered root-caused. GitHub Actions run 40574991395 passed for commit `9fc2264`. Vercel's status check is still failed due to a build-rate-limit/upgrade URL, so no successful Vercel deployment is claimed. See `backend/docs/postgres-migration-execution-status.md` for scope and remaining migration gates.


### Playwright stability adjustment — 28 October 2026

Playwright concurrency is now capped at three workers locally and two in CI to reduce resource contention after one of six E2E tests timed out on the first run but passed on immediate rerun. Commit: `6d6f40d`. This mitigation needs a fresh local E2E run and CI evidence before the intermittent timeout can be considered resolved.


The latest local Playwright rerun after the concurrency cap passed all 6 tests (5.7 seconds), including the Team view/member-search/chat test. This is local evidence only; the new commit still needs CI confirmation. Details are recorded in `backend/docs/postgres-migration-execution-status.md`.

### Latest GitHub CI observation — 28 October 2026

GitHub Actions `TeamFlow CI` run #577 completed successfully for commit `f53cff70d897fecf01c4014d5a2eda750b6494d1`. The combined status for that same commit reports Vercel failure due to the build-rate-limit/upgrade URL; no successful Vercel deployment is claimed. This is a commit-specific CI observation, not proof of PostgreSQL route parity or production readiness. See `backend/docs/postgres-route-parity-audit.md` and `backend/docs/postgres-migration-execution-status.md`. PR #16 remains Draft and MongoDB remains the production/default source of truth.

### PostgreSQL task activity contract fix — 28 October 2026

Source review found the PostgreSQL task activity route returned a simplified list unlike the MongoDB route's combined activity/comment event stream. Commit `b979a5a` aligns the PostgreSQL response shape and merges chronological activity and comment events (latest 150); commit `3a7550d` adds HTTP integration assertions. This implementation has not yet been executed against the isolated PostgreSQL test database in this editing session. See `backend/docs/postgres-route-parity-audit.md` and `backend/docs/postgres-migration-execution-status.md`; run `npm run test:postgres` locally after pulling and check CI for the latest commit before treating the fix as verified. PR #16 remains Draft; MongoDB remains production/default.

## CI follow-up — task activity contract test — 28 October 2026

- CI run #582 exposed a test-file syntax error: the new activity assertion reused an existing `taskActivity` constant name. The production service change was not the reported failure; the integration test module could not load. Commit `50d359d` renames the second variable to `commentActivity` to remove the duplicate declaration.
- The failing run's backend unit tests passed (46 tests across the run summary), but coverage/integration/PostgreSQL steps were skipped after the syntax failure. The fix is not considered verified until CI completes on commit `50d359d` and the PostgreSQL HTTP integration suite executes.

Follow-up from CI run #586: the first activity-shape assertion revealed the new PostgreSQL formatter used generic lowercase action text (`task created`) rather than the exact MongoDB-compatible display text (`created the task`). Commit `f66eb63` adds the same action-to-message mapping used by the Mongo task activity controller. CI and PostgreSQL HTTP integration must pass on this follow-up before this parity fix is closed.

Follow-up from CI run #590: the activity assertion confirmed that PostgreSQL comments write their `COMMENT_ADDED` audit entry to `activity_logs`, not `activity_history`. The feed initially merged `activity_history` and comments but therefore omitted the activity-form comment event. Commit `84cf3ee` adds the task-scoped `activity_logs` records to the combined feed. The focused PostgreSQL integration assertions and full CI must pass on this commit before declaring the response contract verified.


### Invitation API compatibility note — 28 October 2026

The opt-in PostgreSQL invitation DTO now includes populated-style nested project, invitee, and inviter references alongside flattened compatibility fields. This is not a production cutover or a completed parity claim; confirm latest CI and frontend/API behavior before enabling PostgreSQL routing outside an isolated test environment.


Invitation DTO follow-up: commit `7a15938` updates the PostgreSQL HTTP integration assertions for nested populated-style invitee objects. Check latest CI before relying on the compatibility change; PostgreSQL routing remains opt-in and is not approved for production cutover.


Invitation validation follow-up: PostgreSQL invitation endpoints now validate invitation UUID/action input and have HTTP assertions for malformed invitation IDs/actions/invitee IDs. Check the latest CI run for confirmation; PostgreSQL remains opt-in and MongoDB remains the production default.

The PostgreSQL invitation integration suite now includes an expired-invitation acceptance case that checks both the 409 response and persisted `EXPIRED` status; validate it against the latest CI run.


The PostgreSQL integration suite now checks that users cannot mark another account's invitation-accepted notification as read; confirm the latest CI run before treating this additional assertion as verified.

The PostgreSQL notification HTTP tests now cover cross-user read denial, the owner's successful read, and idempotent repeated reads. Confirm current CI before treating the latest assertion as verified.

The PostgreSQL project integration tests now cover non-manager denial for member-role changes as well as invitation-management denial. Verify the latest CI run before treating the newest assertion as passed.


The PostgreSQL HTTP integration suite now exercises settings validation/persistence, dashboard summary response shape, and project-scoped search. Check CI on the latest commit; broader API parity and migration cutover gates remain open.

The PostgreSQL task HTTP tests now explicitly assert that viewers cannot update task fields, while the existing suite continues to exercise permitted viewer comments. Confirm current CI before treating the newest test as passed.

CI follow-up: a duplicate dashboard test variable was corrected in commit `848e756`; check the latest workflow for confirmation before relying on the new settings/dashboard/search assertions.

CI follow-up: commit `e65eb28` corrects a duplicate project-search test variable found after the dashboard variable fix; verify the latest workflow before considering the new assertions passed.


Migration safety: `backend/docs/postgres-cutover-and-rollback-gates.md` defines the required staging, backup/restore, parity, and rollback gates. It is a plan only; no production cutover or real-data import is authorized by this PR.

The PostgreSQL workspace search test now asserts the actual normalized DTO (`type` and `title`) rather than a project `name` field. Verify latest CI before relying on this new test.

The added PostgreSQL preference mutation assertions now run after the existing default-value check to avoid cross-assertion fixture contamination (commit `319a160`). Confirm the latest CI run before relying on these checks.


Authentication follow-up: the opt-in PostgreSQL auth integration tests now include expired email-verification token handling. This does not verify deployed email delivery or authorize production auth cutover; see `backend/docs/postgres-cutover-and-rollback-gates.md`.

The expired email-verification integration test now uses its own synthetic account and cleanup, avoiding interference with the password-reset flow (commit `353b0ab`). Check latest CI before considering the test verified.


Realtime coverage follow-up: the Socket.IO suite now explicitly checks denial of PostgreSQL-backed room joins when membership authorization fails. This remains unit/in-process evidence; browser acceptance against staging is still a cutover gate.
