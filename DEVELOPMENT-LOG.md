### Phase 11: Deployment Configuration and Production Hardening

#### Completed
- Added a Render Blueprint for the backend service.
- Added Vercel SPA rewrite configuration for the frontend.
- Added safe local/production environment templates without real credentials.
- Added Helmet security headers.
- Added explicit CORS origin allow-listing via `CLIENT_ORIGINS`.
- Added authentication rate limiting.
- Added production JWT secret length validation.
- Added structured HTTP request timing logs outside test mode.
- Added graceful SIGTERM/SIGINT shutdown.
- Expanded health response with timestamp and uptime.
- Disabled Express `X-Powered-By`.
- Added production-aware proxy handling.
- Documented Vercel, Render and MongoDB Atlas deployment configuration.

# Kendram Development Log

This file records the actual application build after the six internship simulation documents.

## Foundation

### Phase 1 Frontend
- Responsive Kendram workspace shell
- Reusable Sidebar, Topbar, Avatar, Badge, SectionHeader and card components
- Overview dashboard
- Project, task, team, reports and settings views
- Task creation modal
- Workload aware smart assignment preview
- Local demo workspace mode
- Authentication screen
- Frontend API client
- Live dashboard and project/task loading when the API is available

### Phase 2 Backend
- Express API foundation
- MongoDB connection
- JWT authentication
- User registration and login
- Role based authorization
- Project creation and listing
- Project scoped membership checks
- Project member management
- Task creation and listing
- Task update flow
- Workload aware smart assignment
- Activity logging
- Assignment notifications
- Dashboard summary
- Centralized error handling
- Controlled local demo seed script

### Phase 3 Testing and Refactoring
- Centralized task status and priority validation rules
- Isolated smart assignment service
- Unit tests for task rules
- Unit tests for least loaded assignment behaviour
- Vitest test configuration
- GitHub Actions CI workflow for backend tests and frontend build

### Phase 4: API Integration Testing

#### Completed
- Added a disposable MongoDB integration environment using mongodb-memory-server.
- Added HTTP level API assertions using SuperTest.
- Covered the end to end Kendram workflow from authentication through project creation member addition smart assignment comments notifications activity and persistence verification.
- Added a negative authorization scenario for non-member project access.
- Added a dedicated npm script for the integration suite.

#### Evidence Path
```text
API request
   -> Express route
   -> Authentication / Authorization
   -> Service layer
   -> MongoDB test database
   -> Response
   -> Persistence assertions
```

### Phase 5: Live Frontend Management

#### Completed
- Reworked frontend data loading to retrieve members and tasks for every accessible project.
- Added live project progress, completed-task totals and member counts.
- Added project-aware task creation with selectable project and project-specific assignee lists.
- Added live task filters for status, priority and text search.
- Added a live My Tasks queue scoped to the authenticated user.
- Added live task editing for status, priority, assignee and due date.
- Added live project member candidate search by name or email.
- Added controlled member-add flow with duplicate membership protection.
- Updated the Team view to aggregate workload across live projects.
- Removed fixed demo project/member avatars from the live project cards.
- Added live user identity and task counts to the navigation shell.

### Phase 6: Browser Regression Testing

#### Completed
- Added Playwright Test browser tooling.
- Added Chromium browser regression coverage for demo navigation and task creation.
- Added live API-backed UI regression coverage using deterministic API interception.
- Covered live project progress rendering and task filtering.
- Covered live task details updates for status and priority.
- Covered live project member search and add flow.
- Updated CI to install Chromium and run the browser suite.


### Phase 7: Authentication UX

#### Completed
- Demo mode is now session-only and no longer persists as an authenticated-looking local user after a page refresh.
- Added a visible “Exit demo · Back to sign in” control in the workspace header.
- Added a full Create Account flow to the login screen.
- New accounts are created through the existing backend registration endpoint and are provisioned as TEAM_MEMBER users.
- Added client-side password confirmation and minimum-length validation before registration.
- Added browser regression coverage for account mode switching and demo exit.


### Phase 8: Live Data Integrity Cleanup

#### Completed
- Removed mock task, project, activity and workload fallbacks from authenticated live pages.
- Dashboard greeting and date are now derived from the signed-in account and current date/time.
- Live Projects, Team, Reports, Settings and My Tasks views now show empty states when the API returns no records instead of demo records.
- Team Member users no longer see Project Manager-only project/member management controls.
- Project progress and member counts remain derived from live API records.
- Project member listing is now readable by authorized project members while member search/add remains manager-controlled.
- Added browser regression coverage to verify a new empty live account does not see demo users or projects.


### Phase 9: Navigation, Session Stability and Typography

#### Completed
- Added startup session validation through the authenticated `/auth/me` endpoint.
- Added a temporary authentication loading screen so stale session data is not rendered during startup.
- Added recovery for `/auth/login` when an authenticated session is already present; the application returns to the workspace root.
- Navigation state now clears the selected task and remains inside the SPA instead of relying on URL route changes.
- Increased UI typography across navigation, dashboard, tables, cards, forms, modals, reports and settings for a more readable balanced scale.
- Added browser regression coverage for authenticated navigation across Projects, My Tasks, Team, Reports and Settings.


### Phase 10: URL Routing, Create Project and Typography Refinement

#### Completed
- Added stable client-side routes for Overview, Projects, My Tasks, Team, Reports and Settings.
- Browser back/forward navigation now restores the corresponding workspace page.
- Authenticated sessions are redirected away from `/auth/login`; unauthenticated sessions are normalized to the login route.
- Added a functional Create Project action to the live Projects page for authenticated users.
- The backend now permits authenticated users to create projects; the creator becomes the project owner and initial project member.
- Project member management remains owner/administrator controlled.
- Added a final typography refinement pass that increases secondary/subtext sizes for readability without oversized headings.
- Added regression coverage for page URLs and project-creation access.

## Current Architecture

Frontend
React and Vite

Backend
Node.js and Express

Database
MongoDB

API
REST with JSON

Authentication
JWT Bearer tokens

Testing
Vitest unit and integration tests
Playwright browser regression tests

Source Control
Git and GitHub

## Current User Journey

Login -> Workspace -> Projects -> Create Project -> Create Task -> Smart Assignment -> Task Details -> Status/Priority/Assignee/Due Update -> Comment -> Activity -> Notification -> Team Member Management

## Current State

The repository contains the six-week documentation, the Kendram application implementation, backend API integration tests, and browser regression coverage. Local execution still requires installing project dependencies and providing a MongoDB instance for the real backend.

## Next Build Milestones

1. Run the complete CI suite and resolve any environment-specific failures.
2. Add deployment configuration for the frontend and backend.
3. Add production environment hardening, observability and final accessibility checks.


### Phase 13 — Email verification and password recovery

- Added signup email verification; newly created users are marked unverified and cannot sign in until the email link is redeemed.
- Added a resend-verification flow with generic messaging to reduce account enumeration.
- Added forgot-password and reset-password screens to the sign-in page.
- Added secure random, single-use 30-minute verification and reset tokens. Only SHA-256 hashes and expiry timestamps are stored.
- Added endpoints for verification, resend, forgot password and reset password, protected by the existing authentication rate limiter.
- Integrated email delivery through the Resend HTTP API.
- Added `APP_URL`, `RESEND_API_KEY` and `EMAIL_FROM` configuration documentation.
- Updated README and development log in the same branch.
- Validation status: CI and full end-to-end verification are pending; email delivery requires a configured Resend API key and permitted sender.
