# Known limitations and rubric tracking

This document intentionally distinguishes implementation from proof.

| Requirement | Current implementation / evidence | Remaining work |
|---|---|---|
| Relational schema | Normalized PostgreSQL reference schema and 15-person seed data are in database/postgres-schema.sql; the running API still uses MongoDB/Mongoose | Migrate runtime persistence if evaluator requires SQL end-to-end |
| Board and columns entities | Task status is the current workflow model | Add explicit Board/Column models if required by evaluator |
| Auth and role permissions | Existing JWT, bcrypt, project membership and viewer restrictions | Continue negative authorization testing |
| Drag/drop + version conflict | Task model and API use a version compare-and-swap | Verify UI sends version and rolls back optimistic UI state on 409 |
| Filtering/pagination | Backend task list implements page/limit, assignee, label and due-date range filters | Add/verify UI controls for all query options |
| 80% backend coverage | Latest CI coverage report: 61.4% statements, 49.12% branches, 60.76% functions, 71.35% lines | Add tests until measured backend coverage reaches at least 80%; target is not met yet |
| Realtime updates/activity | Socket.IO and ActivityLog exist | Run multi-client acceptance tests |
| Under 300 ms at 1,000 tasks | Indexes added for project/status/assignee/due date/labels | Run a repeatable load test; do not claim target met before evidence |
| Docker Compose | MongoDB, backend and frontend services are defined | Build and run on a machine with Docker; confirm end-to-end behavior |
| OpenAPI and data diagram | openapi.yaml and kanban-database-diagram.md | Validate spec against routes and actual responses |
| Test plan/results and architecture note | test-plan.md, architecture-decisions.md | Attach real CI, coverage, performance and acceptance results |
