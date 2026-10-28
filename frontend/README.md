# TeamFlow Web

The frontend for the TeamFlow Smart Task Management and Collaboration Platform.

## Current Phase

The frontend now includes the reusable visual foundation and the first authentication layer.

### Implemented

- Responsive workspace shell
- Sidebar and topbar navigation
- Overview dashboard
- Project cards
- Task table
- Team workload view
- Recent activity feed
- Reports and settings views
- Reusable Create Task modal
- Workload aware smart assignment preview
- Login screen
- API client for the TeamFlow backend
- Local demo workspace mode

The UI currently keeps dashboard mock data isolated so the visual experience can be reviewed without a running database. Real authentication is connected to the backend API.

## Structure

- src/components - reusable UI primitives and feature components
- src/pages - page level compositions
- src/data - mock and domain data
- src/auth - authentication provider
- src/lib - API client and integration helpers
- src/App.jsx - application state and navigation

## Run

npm install
npm run dev

## API Configuration

Configure the existing `.env` file with `VITE_API_BASE_URL` if the backend API base URL differs from `http://localhost:5000/api/v1`.

## Build Sequence

1. Reusable frontend foundation
2. Express and MongoDB backend
3. Authentication integration
4. Project and task persistence
5. Smart assignment service integration
6. Notifications and activity history
7. Automated testing and production refinement

## Design Principles

- Reusable components
- Feature oriented composition
- Data driven UI
- Responsive layouts
- Clear separation between UI and API logic
- No secrets in the frontend repository
