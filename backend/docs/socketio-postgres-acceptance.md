# Socket.IO and PostgreSQL migration acceptance

This checklist is for the `feat/postgres-persistence` draft branch. It is not a production cutover authorization.

## Safety invariants
- Keep PR #16 in Draft and unmerged.
- MongoDB remains the production/default source of truth.
- Keep PostgreSQL feature flags disabled in production.
- Do not seed either `Kendram_db` or `kendram_pg_dev_test`.
- Do not run a MongoDB importer or reconcile real data without explicit approval.
- Never paste credentials, JWTs, or full database URLs into logs or chat.

## Socket.IO validation

The backend unit tests exercise a real local Socket.IO server with mocked user and chat persistence. They cover token rejection, active-user authentication, membership-gated room joins, room isolation, message/reaction events, leaving rooms, and the PostgreSQL authorization branch. They do not prove the deployed frontend, deployed API, or a real PostgreSQL database works end to end.

Run these checks in a dedicated non-production environment with two test accounts and a project whose membership is known:

1. Sign in as test member A in browser A and member B in browser B.
2. Open the same project chat in both browsers. Send a uniquely identifiable message from A; verify it appears once in B without refresh.
3. Open a different project in B. Send another message in A's project; verify B does not receive it.
4. Remove B from the project (using a manager account), then reconnect B and attempt to join. The join must be denied. Also verify the application does not continue to display new messages from the removed project after access is revoked.
5. With a still-authorized member, toggle network connectivity or restart the local backend, then restore connectivity. Verify the client reconnects, re-authenticates, rejoins the selected room, and receives subsequent messages exactly once.
6. Repeat after signing out or invalidating the token. A stale/invalid token must not regain access.
7. Repeat the authorization checks with the PostgreSQL auth/project flags enabled only in the isolated local test environment and with mapped test accounts/project membership. Do not enable these flags in production.

Record the environment, branch SHA, test account roles, result, and any sanitized console/server error. Do not include tokens or connection strings.

## PostgreSQL query concurrency warning

The integration suite has emitted a `pg` deprecation warning about calling `client.query()` while the same client is already executing a query. It is not a passing or failing assertion, and its source must be identified before changing transaction code.

From the backend directory in PowerShell, reproduce with a stack trace:

```powershell
$env:NODE_OPTIONS = "--trace-deprecation"
npm run test:integration
Remove-Item Env:NODE_OPTIONS
```

If the warning is emitted by a test, first inspect whether that test starts multiple operations on the same checked-out client without awaiting them. If it is emitted by application code, inspect the traced service and its transaction boundaries. Queries on a single checked-out client must be serialized and awaited in order; use the pool for independent concurrent operations. Do not run the same operation concurrently on a client inside a transaction. After a fix, rerun the focused test, `npm test`, and `npm run test:integration`.

## MongoDB/PostgreSQL parity audit

Review every Express route mounted in the application, not only the routes that already have PostgreSQL counterparts. For each route, record:
- MongoDB/default handler and PostgreSQL counterpart (or explicitly `not implemented`);
- authentication and authorization checks, including owner, project manager, member, viewer, and administrator behavior;
- input validation, response DTO shape, status codes, pagination/filter semantics, and error behavior;
- transaction/rollback behavior for multi-write operations;
- associated integration tests.

At minimum, cover registration, email verification, login/session, profile, projects, members/roles, invitations, tasks and task dependencies, labels, comments, chat/reactions, notifications, activity, settings, dashboard/analytics/insights, search, and assignment suggestions. A route with no equivalent implementation must stay on the MongoDB path when PostgreSQL mode is enabled; do not silently claim parity.

## Cutover gate

Do not merge or enable global PostgreSQL mode until route parity is reviewed, data migration/import and reconciliation are proven repeatable, rollback/recovery has been exercised, email delivery and realtime acceptance pass, and the full test suite passes against a deliberately isolated test database. CI green alone does not prove those conditions.
