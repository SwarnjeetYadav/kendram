# PostgreSQL cutover and rollback gates

Status: **planning only — no production cutover authorized**  
Last reviewed: 28 October 2026

This runbook is a gate checklist, not authorization to run migration/import commands. The current development milestone uses isolated synthetic fixtures. MongoDB remains the production source of truth; keep `POSTGRES_AUTH_ENABLED`, `POSTGRES_PROJECTS_ENABLED`, `POSTGRES_TASKS_ENABLED`, and `VITE_POSTGRES_API_ENABLED` disabled in production.

## Preconditions before any staging rehearsal

- [ ] Name an owner and record the exact staging environment and database identity without copying credentials into chat, logs, or Git.
- [ ] Confirm the target is disposable staging, not `Kendram_db`, `kendram_pg_dev_test`, or production.
- [ ] Take a database backup/snapshot and prove restoration into a separate disposable database.
- [ ] Confirm migrations are backward-compatible with the currently deployed MongoDB-backed application.
- [ ] Run backend unit/integration tests, PostgreSQL tests, frontend build, and browser tests on the exact candidate commit.
- [ ] Review the latest route parity audit and explicitly accept or close every route/role/DTO/error gap.
- [ ] Verify auth/email verification/password reset and account identity mapping with synthetic accounts.
- [ ] Verify Socket.IO two-client delivery, project-room isolation, membership revocation, reconnect behavior, and client error handling.
- [ ] Rehearse importer dry-run and reconciliation only in the approved disposable staging environment after source-domain coverage is complete. Never use the importer as a routine feature test.
- [ ] Record source/target counts and relationship checks for every in-scope entity; investigate all mismatches before any write-mode import.
- [ ] Define an observation window, error/latency thresholds, decision owner, and rollback trigger before enabling any flag.

## Cutover gates

1. Deploy schema/migrations first using the controlled deployment pipeline.
2. Keep MongoDB routes and connection configuration available.
3. Enable only one approved feature family in staging, then run smoke and regression checks before proceeding to the next family.
4. Compare API error rates, authorization outcomes, latency, and key business counts against the baseline.
5. Do not switch all frontend routing at once until auth/profile, projects/members, tasks, workspace endpoints, notifications, invitations, and realtime behavior have explicit sign-off.
6. Production enablement requires a separate approval; a green CI run alone is insufficient.

## Rollback procedure (rehearse only in disposable staging)

1. Stop further imports/writes and record the exact timestamp and candidate commit.
2. Disable the PostgreSQL frontend route switch and all PostgreSQL runtime flags using the deployment configuration system.
3. Roll application traffic back to the known-good MongoDB-backed deployment. Keep MongoDB available as the production source of truth.
4. Do not automatically drop PostgreSQL tables or reverse schema migrations during an incident. Preserve evidence and determine whether any PostgreSQL-only writes occurred.
5. Restore the staging snapshot into a separate disposable database and verify that the backup is usable; do not overwrite the source database during the rehearsal.
6. Compare pre/post rollback request outcomes and record any writes that would be lost or require reconciliation.
7. Confirm health checks and core flows on MongoDB: login/profile, project membership, task CRUD, notifications/invitations, and chat.
8. Document the cause, reconciliation plan, and explicit authorization needed before attempting another cutover.

## Current blockers

- Full MongoDB/PostgreSQL response, error, pagination, and role-matrix parity is not yet proven.
- Real-browser PostgreSQL-backed chat acceptance is not yet proven by this runbook.
- No end-to-end staging backup/restore or cutover rollback rehearsal has been performed by this change.
- The MongoDB-to-PostgreSQL importer remains outside routine validation and must not be run without explicit approval and verified staging identity.

## Evidence log

Append the candidate commit, CI run, staging target identifier (non-secret), backup/restore evidence, parity exceptions, approver, and outcome only after each step actually occurs. Never record connection strings, tokens, passwords, or raw environment dumps.


## Authentication boundary

The opt-in PostgreSQL auth integration suite exercises verification/login, profile persistence, password reset token single-use, and bearer-token rejection with synthetic records. This is not evidence that production identity mappings are reconciled, the deployed email provider/domain is verified, or all frontend auth/profile flows are ready for cutover. Keep `POSTGRES_AUTH_ENABLED` disabled in production until those checks have explicit staging evidence and approval.


### Realtime evidence distinction

The automated Socket.IO suite exercises authenticated clients, room isolation, membership revocation, reconnect/rejoin, and PostgreSQL project-room authorization using in-process servers and test doubles. Before cutover, run the same critical flows through two real browser sessions against the actual staging deployment and PostgreSQL database; capture the candidate commit, test accounts (non-secret identifiers only), expected/observed results, and any console/server errors.
