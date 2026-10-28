# Kendram PostgreSQL and realtime acceptance checklist

This checklist supplements automated backend tests. It does not authorize a production cutover. Keep PR #16 in Draft, leave all PostgreSQL flags disabled by default, and keep MongoDB as the production source of truth.

## Automated chat security regression coverage

The unit suite covers missing, invalid, and expired access tokens; project-room isolation; member removal from an active room; denial of a rejoin after the membership lookup reflects removal; reconnect/rejoin for an authorized member; and the PostgreSQL authorization path when the project flag is enabled.

Run from `backend/`:

```powershell
npm test
npm run test:integration
npm run test:postgres
```

## Manual browser acceptance — required

Use two separate browser profiles or an incognito window and a normal window. Sign in as distinct users with known memberships. Do not use production data.

1. **Authorized same-room delivery:** add both test users to disposable project A. Open its chat in both sessions. Send a new message in session A and confirm session B receives it without refreshing. Repeat for a reaction.
2. **Room isolation:** sign a third test user into a session that is only a member of disposable project B. Confirm messages and reactions sent in project A do not appear in project B.
3. **Immediate removal:** keep member B connected to project A, remove B through the member-management UI, then send a message in A. Confirm B stops receiving events without needing to refresh or sign out.
4. **Reconnect after removal:** after removing B, force a page reload or reconnect the socket. Confirm B receives a denied membership acknowledgement and cannot receive new project A events.
5. **Invalid/expired authentication:** use the application's supported test mechanism to sign in with an expired session/token. Confirm the socket is rejected and the UI returns to an authenticated state rather than joining chat. Do not expose tokens in screenshots or logs.
6. **Authorized reconnect:** disconnect a still-authorized member's network or reload the chat page. Confirm the socket re-authenticates, rejoins the room, and receives subsequent messages.
7. **Feature-flag isolation:** in an isolated local test environment only, repeat the relevant authorization test with `POSTGRES_PROJECTS_ENABLED=true`, and verify that the Postgres authorization path is used. Restore the flag to `false` afterwards. Do not change production flags.

Record the environment, commit SHA, test accounts (aliases only), expected result, actual result, and screenshots with personal data/tokens redacted.

## Route-parity verification matrix

For each listed domain, compare MongoDB-default and PostgreSQL-opt-in behavior using equivalent fixtures and roles. Record HTTP status, response DTO, pagination, validation errors, and persisted result.

| Domain | Required comparisons |
|---|---|
| Comments and reactions | create/list/delete or edit operations supported by each API; project/task authorization; ordering; reaction persistence |
| Activity and notifications | owner/member visibility; unread/read transitions; pagination; legacy IDs and event types |
| Dashboard and analytics | task totals, overdue/completed counts, project scoping, empty datasets, date boundaries |
| Search | member/project/task scope, query validation, role filtering, empty results, result DTOs |
| Invitations | create/list/accept/reject or revoke flows supported by the API; expiry; duplicate/replay protection; membership creation |
| Settings/profile | field validation, allowed fields, persistence, authentication, response shape; explicitly identify profile endpoints still backed by MongoDB |
| Authorization/errors | owner, administrator, project manager, member, viewer; invalid IDs; missing resources; conflict and validation status codes |
| Labels/dependencies | Mongo source semantics, exact label matching, dependency edges/counts, blocker metadata, migration/import coverage |

A route is not “parity complete” merely because it exists. It must have comparable semantics and automated tests for the important success, validation, authorization, and failure cases.

## Migration, rollback, and cutover gates

- Keep `POSTGRES_AUTH_ENABLED`, `POSTGRES_PROJECTS_ENABLED`, and `POSTGRES_TASKS_ENABLED` false by default.
- Do not seed either `Kendram_db` or `kendram_pg_dev_test`; do not import source data without explicit approval.
- Run migration preflight only against explicitly selected non-production source/target systems and review blockers before any write-capable import.
- Before cutover, prove a repeatable import/reconciliation process, count and relationship parity, backup/restore, rollback, and application behavior when each feature flag is disabled.
- Socket.IO room revocation is local to a single Socket.IO server unless a shared adapter is configured. Multi-instance delivery and revocation need separate verification if the deployment uses more than one instance.
- Keep PR #16 as Draft until all applicable checks are evidenced. A green CI run does not prove browser acceptance, real-data reconciliation, email delivery, multi-instance fan-out, or production rollback.
