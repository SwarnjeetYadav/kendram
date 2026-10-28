# TeamFlow API

Backend for the TeamFlow Smart Task Management and Collaboration Platform.

## Phase 4: API Integration Testing

The backend now includes an executable integration test path using an isolated in-memory MongoDB instance and HTTP-level assertions.

### Current features

- JWT authentication
- Role based authorization
- Projects and project membership
- Tasks and smart assignment
- Activity logging
- Notifications
- Dashboard summary
- Comments
- Centralized API error handling

### Refactoring improvements

- Task status and priority rules are centralized.
- Smart assignment logic is isolated in an assignment service.
- Controllers remain thin and delegate to services.
- Project scoped authorization is kept inside service boundaries.
- Internal server errors are not returned directly to clients.

### Automated test suites

Unit baseline:

    npm test

Integration suite:

    npm run test:integration

The integration suite provisions a disposable in-memory MongoDB database, then exercises a realistic flow:

    Login
      -> Create Project
      -> Add Member
      -> Create Existing Work
      -> Smart Assignment
      -> Add Comment
      -> Read Notifications
      -> Read Activity
      -> Verify Persistence

It also verifies that a non-member cannot read a private project.

### Local setup

1. Copy .env.example to .env for normal development only.
2. Install dependencies.
3. Run npm test for unit tests.
4. Run npm run test:integration for isolated API integration tests.
5. Run npm run dev for the development server.

The repository intentionally excludes .env and node_modules.

### Test note

mongodb-memory-server downloads a MongoDB binary for the isolated test environment, so the first integration test run may take longer than subsequent runs.
