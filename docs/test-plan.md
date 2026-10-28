# Team Task Board / Kendram test plan

## Scope
Verify access control, task CRUD, labels and filters, pagination, optimistic concurrency, comments/activity, real-time updates, responsive UI, deployment and performance.

## Automated test categories

| Category | Test cases | Evidence to capture |
|---|---|---|
| Authentication | Missing token, malformed token, valid token, blocked unauthenticated access | Test output |
| Authorization | Non-member reads/updates a task; viewer attempts a mutation; manager/member allowed actions | API integration results |
| Validation | Empty title, unsupported status/priority, malformed IDs/date, invalid labels, page/limit out of range | Status and JSON error body |
| Task listing | Page boundaries, total count, assignee, unassigned, label, due-date range, overdue filter | Request/response samples |
| Concurrency | Two updates with the same version; first succeeds and second returns 409 | Automated integration test |
| Realtime | Two authenticated clients, event delivery, reconnect, unauthorized room access | Browser/network test |
| Security | Password hash not returned, secret absent from bundle/logs, CORS allow-list, rate limits | CI and manual checklist |
| Performance | Seed 1,000 tasks; run repeated list requests; report p50/p95/max and environment | Load-test output |
| Docker | docker compose up --build; health checks; SPA deep link; task API works | Compose logs and screenshots |

## Required negative cases
- Missing/invalid authentication token.
- User outside a project attempts to list or update tasks.
- Viewer role attempts to create/update tasks.
- Invalid JSON payload, unsupported status, invalid label array and malformed dates.
- Stale task version produces HTTP 409.
- Pagination values are invalid or exceed the configured maximum.
- Email provider/network failure does not report a successful email send.

## Latest CI evidence
- Workflow run: https://github.com/SwarnjeetYadav/junior-software-developer-intern/actions/runs/40284638660
- Backend unit/integration jobs passed on the initial PR revision; the Kanban acceptance integration file reports 3 passing tests, and all four integration test files report 12 passing tests total.
- Initial backend coverage baseline: 61.4% statements, 49.12% branches, 60.76% functions, 71.35% lines. This is below the 80% statement-coverage target; do not report the target as achieved.
- Performance under 1,000 tasks has not yet been benchmarked. Docker image build verification is being added to CI.

## Results
**Do not mark tests as passed until they have actually been run.** Record commit SHA, date, environment, command, pass/fail counts, coverage percentage and artifacts after each CI run. No performance number is asserted by this plan.

## Suggested commands

    cd backend
    npm ci
    npm test
    npm run test:integration

Run the frontend regression suite from frontend using the repository's configured Playwright setup. Run load testing separately against a disposable seeded environment.
