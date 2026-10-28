# Task Creation and Smart Assignment - Prototype Record

## Feature Summary
An authorized Project Manager creates a task inside a project. The task is validated, an explicit assignee is checked for project membership, or a lower workload eligible member is suggested when no assignee is provided. The task is persisted, an activity event is recorded, and an assignment notification event is created when appropriate.

## Endpoint
POST /api/v1/projects/{projectId}/tasks

## Key Data Structures
- Task object
- Set for eligible member IDs
- Map for member to active task count
- Array for candidate members
- Queue for notification events
- Activity record for audit history

## Core Algorithm
1. Authenticate the request.
2. Authorize CREATE_TASK for the project.
3. Validate the project and task payload.
4. Load active project members.
5. Validate an explicit assignee or calculate a smart suggestion.
6. Create the task with TODO status.
7. Persist the task.
8. Record TASK_CREATED activity.
9. Enqueue TASK_ASSIGNED notification when applicable.
10. Return the task.

## Smart Assignment Rule
When no assignee is supplied, compare the number of active tasks for each eligible member and select the lowest workload candidate. A later implementation can add priority weight or due date pressure.

## Error Cases
401 unauthenticated
403 unauthorized
404 project not found
400 invalid payload
422 invalid assignee
500 database failure

## Prototype Boundary
The Week 3 deliverable documents the intended logic and code structure. It does not claim that this feature is implemented in production.
