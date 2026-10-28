import { test, expect } from '@playwright/test'

const project = {
  _id: 'project-1',
  name: 'Anvaya Web App',
  description: 'Core Anvaya workspace',
  ownerId: 'user-1',
  dueDate: '2026-10-24T00:00:00.000Z',
  status: 'ACTIVE',
}

const users = {
  owner: { _id: 'user-1', name: 'Swarnjeet Yadav', email: 'swarnjeet@example.com', role: 'PROJECT_MANAGER', status: 'ACTIVE' },
  teammate: { _id: 'user-2', name: 'Ankit Kumar', email: 'ankit@example.com', role: 'TEAM_MEMBER', status: 'ACTIVE' },
  candidate: { _id: 'user-3', name: 'Priya Shah', email: 'priya@example.com', role: 'TEAM_MEMBER', status: 'ACTIVE' },
}

function taskState() {
  return [
    {
      _id: 'task-1',
      projectId: project._id,
      title: 'Build live task board',
      description: 'Regression task',
      priority: 'HIGH',
      status: 'TODO',
      assigneeId: users.owner,
      dueDate: '2026-10-15T00:00:00.000Z',
      estimateMinutes: 120,
      dependencyCount: 0,
      blockedByCount: 0,
      blockingCount: 0,
      blockedByTaskIds: [],
      blockingTaskIds: [],
      hasBlockingDependencies: false,
      createdAt: '2026-10-08T00:00:00.000Z',
    },
    {
      _id: 'task-2',
      projectId: project._id,
      title: 'Review API contract',
      description: '',
      priority: 'MEDIUM',
      status: 'COMPLETED',
      assigneeId: users.teammate,
      dueDate: '2026-10-10T00:00:00.000Z',
      estimateMinutes: 60,
      dependencyCount: 0,
      blockedByCount: 0,
      blockingCount: 0,
      blockedByTaskIds: [],
      blockingTaskIds: [],
      hasBlockingDependencies: false,
      createdAt: '2026-10-06T00:00:00.000Z',
      startedAt: '2026-10-06T00:00:00.000Z',
      completedAt: '2026-10-08T00:00:00.000Z',
    },
  ]
}

function routeApi(page) {
  const state = {
    projects: [project],
    members: [
      { _id: 'membership-1', projectId: project._id, userId: users.owner, projectRole: 'PROJECT_MANAGER' },
      { _id: 'membership-2', projectId: project._id, userId: users.teammate, projectRole: 'MEMBER' },
    ],
    tasks: taskState(),
    chats: [],
    dependencies: [],
    invitations: [],
  }

  return page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace('/api/v1', '')
    const method = request.method()
    const json = async (status, data) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data }),
    })

    if (method === 'GET' && path === '/auth/me') return json(200, users.owner)
    if (method === 'GET' && path === '/dashboard/summary') {
      return json(200, { activeProjects: 1, openTasks: state.tasks.filter((item) => item.status !== 'COMPLETED').length, completedTasks: 1, overdueTasks: 0 })
    }
    if (method === 'GET' && path === '/projects') return json(200, state.projects)
    if (method === 'GET' && path === '/activity') return json(200, [])
    if (method === 'GET' && path === '/notifications') return json(200, [])

    if (method === 'GET' && path === '/projects/project-1/members') return json(200, state.members)
    if (method === 'GET' && path === '/projects/project-1/members/candidates') {
      const query = (url.searchParams.get('q') || '').toLowerCase()
      const already = new Set(state.members.map((item) => item.userId._id))
      return json(200, query.length >= 2 && !already.has(users.candidate._id) && users.candidate.name.toLowerCase().includes(query) ? [users.candidate] : [])
    }
    if (method === 'POST' && path === '/projects/project-1/members') {
      const body = JSON.parse(request.postData() || '{}')
      state.members.push({ _id: 'membership-3', projectId: project._id, userId: users.candidate, projectRole: body.projectRole || 'MEMBER' })
      return json(201, users.candidate)
    }
    if (method === 'PATCH' && /^\/projects\/project-1\/members\//.test(path)) return json(200, users.candidate)
    if (method === 'DELETE' && /^\/projects\/project-1\/members\//.test(path)) return json(200, {})

    if (method === 'GET' && path === '/tasks/project/project-1') return json(200, state.tasks)
    if (method === 'POST' && path === '/tasks/project/project-1') {
      const body = JSON.parse(request.postData() || '{}')
      const task = { _id: 'task-' + (state.tasks.length + 1), projectId: project._id, status: 'TODO', priority: 'MEDIUM', ...body, assigneeId: body.assigneeId ? users.owner : users.owner, dependencyCount: 0, blockedByCount: 0, blockingCount: 0, blockedByTaskIds: [], blockingTaskIds: [], hasBlockingDependencies: false, createdAt: new Date().toISOString() }
      state.tasks.push(task)
      return json(201, task)
    }
    if (method === 'PATCH' && /^\/tasks\/task-/.test(path)) {
      const taskId = path.split('/').pop()
      const body = JSON.parse(request.postData() || '{}')
      const task = state.tasks.find((item) => item._id === taskId)
      Object.assign(task, body)
      if (body.status === 'COMPLETED') task.completedAt = new Date().toISOString()
      return json(200, task)
    }
    if (method === 'GET' && /^\/tasks\/task-1\/activity$/.test(path)) return json(200, [])
    if (method === 'GET' && /^\/tasks\/task-1\/dependencies$/.test(path)) return json(200, state.dependencies)
    if (method === 'POST' && /^\/tasks\/task-1\/dependencies$/.test(path)) {
      const dependency = {
        _id: 'dependency-1',
        projectId: project._id,
        predecessorTaskId: state.tasks[1],
        successorTaskId: state.tasks[0],
      }
      state.dependencies = [dependency]
      return json(201, dependency)
    }
    if (method === 'DELETE' && /^\/tasks\/task-1\/dependencies\//.test(path)) {
      state.dependencies = []
      return json(200, {})
    }
    if (method === 'GET' && /^\/tasks\/task-1\/assignment-suggestions$/.test(path)) {
      return json(200, [
        { userId: users.teammate._id, user: users.teammate, projectRole: 'MEMBER', activeTaskCount: 0, activeMinutes: 0, assignmentScore: 0.92, reason: 'workload is low, role matches, priority load is manageable' },
        { userId: users.owner._id, user: users.owner, projectRole: 'PROJECT_MANAGER', activeTaskCount: 1, activeMinutes: 120, assignmentScore: 0.64, reason: 'workload is high, role matches' },
      ])
    }
    if (method === 'GET' && path.startsWith('/comments/tasks/')) return json(200, [])

    if (method === 'GET' && path === '/projects/project-1/analytics') {
      return json(200, {
        totalTasks: 2, completedTasks: 1, completionRate: 50, overdueTasks: 0, overdueRate: 0, blockedTasks: 0,
        dependencyCount: state.dependencies.length, medianCycleTimeHours: 48, workload: [{ userId: users.owner._id, activeTasks: 1 }],
        workloadSpread: 0, throughput: [{ week: '2026-09-21', completed: 0 }, { week: '2026-09-28', completed: 1 }],
      })
    }
    if (method === 'GET' && path === '/projects/project-1/insights') {
      return json(200, [{ type: 'PROJECT_HEALTH', severity: 'LOW', signal: 'Healthy', reason: 'Most tracked work is complete.', action: 'Keep the current delivery rhythm.', entityIds: [] }])
    }
    if (method === 'GET' && path === '/projects/project-1/activity') return json(200, [])

    if (method === 'GET' && path === '/projects/project-1/chat') return json(200, state.chats)
    if (method === 'POST' && path === '/projects/project-1/chat') {
      const body = JSON.parse(request.postData() || '{}')
      const message = { _id: 'message-' + (state.chats.length + 1), projectId: project._id, userId: users.owner, message: body.message, createdAt: new Date().toISOString(), mentions: [], reactions: [] }
      state.chats.push(message)
      return json(201, message)
    }
    if (method === 'POST' && /^\/projects\/project-1\/chat\/[^/]+\/reactions$/.test(path)) {
      const body = JSON.parse(request.postData() || '{}')
      const messageId = path.split('/').at(-2)
      const found = state.chats.find((item) => item._id === messageId)
      if (found) found.reactions = [{ userId: users.owner._id, emoji: body.emoji }]
      return json(200, found || {})
    }

    if (method === 'GET' && path === '/projects/project-1/invitations') return json(200, state.invitations)
    if (method === 'POST' && path === '/projects/project-1/invitations') {
      const body = JSON.parse(request.postData() || '{}')
      const invitation = { _id: 'invite-' + (state.invitations.length + 1), projectId: project._id, invitedUserId: users.candidate, projectRole: body.projectRole || 'MEMBER', status: 'PENDING' }
      state.invitations.push(invitation)
      return json(201, invitation)
    }
    if (method === 'GET' && path === '/invitations') return json(200, [])
    if (method === 'PATCH' && /^\/invitations\//.test(path)) return json(200, {})

    if (method === 'GET' && path === '/search') {
      const query = (url.searchParams.get('q') || '').toLowerCase()
      return json(200, {
        projects: query.includes('anvaya') ? [{ _id: project._id, name: project.name, status: project.status }] : [],
        tasks: query.includes('board') ? [{ ...state.tasks[0], assigneeId: users.owner, projectName: project.name }] : [],
        members: query.includes('ankit') ? [users.teammate] : [],
      })
    }

    return json(200, [])
  })
}

async function seedLiveSession(page) {
  await page.addInitScript(() => {
    localStorage.setItem('teamflow_token', 'playwright-token')
    localStorage.setItem('teamflow_user', JSON.stringify({
      id: 'user-1',
      name: 'Swarnjeet Yadav',
      initials: 'SY',
      role: 'PROJECT_MANAGER',
    }))
  })
}

test('demo workspace navigation and task creation remain functional', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Preview demo workspace/i }).click()
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Swarnjeet/i })).toBeVisible()

  await page.getByRole('button', { name: /My Tasks/ }).click()
  await page.getByRole('button', { name: /Create task/i }).click()
  await page.getByLabel('Task title').fill('Browser regression task')
  await page.getByRole('button', { name: 'Create task', exact: true }).click()
  await expect(page.getByText('Browser regression task')).toBeVisible()
})

test('live project workspace exposes board, calendar, dependencies and insights', async ({ page }) => {
  await seedLiveSession(page)
  await routeApi(page)
  await page.goto('/')

  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect(page.locator('.project-workspace').getByRole('heading', { name: 'Anvaya Web App' })).toBeVisible()

  await page.getByRole('tab', { name: 'Board' }).click()
  await expect(page.getByRole('heading', { name: /Build live task board/i })).toBeVisible()
  await page.getByText('Build live task board').click()
  await expect(page.locator('.task-details-modal').getByRole('heading', { name: 'Build live task board' })).toBeVisible()
  await expect(page.getByText('Smart Assignment 2.0')).toBeVisible()
  await page.locator('.task-details-modal').getByLabel('Status').selectOption('IN_PROGRESS')

  await page.locator('.task-details-modal .dependency-form select').selectOption('task-2')
  await page.locator('.task-details-modal').getByRole('button', { name: /Add blocker/i }).click()
  await expect(page.locator('.task-details-modal .dependency-row').first()).toBeVisible()
  await expect(page.locator('.task-details-modal .dependency-row')).toContainText('Review API contract')
  await page.getByRole('button', { name: /Close details/i }).click()

  await page.getByRole('tab', { name: 'Calendar' }).click()
  await expect(page.getByText(/Calendar/i).first()).toBeVisible()
  await page.getByRole('tab', { name: 'Activity' }).click()
  await expect(page.getByRole('heading', { name: 'Project activity' })).toBeVisible()
})

test('live Team view supports member management, invitations and floating chat', async ({ page }) => {
  await seedLiveSession(page)
  await routeApi(page)
  await page.goto('/')

  await page.getByRole('button', { name: 'Team', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Manage your project team' })).toBeVisible()

  await page.getByLabel('Search users to add').fill('Priya')
  await expect(page.getByText('Priya Shah')).toBeVisible()
  await page.getByRole('button', { name: 'Invite', exact: true }).click()
  await expect(page.getByText(/Priya Shah was invited as/i)).toBeVisible()

  await page.getByRole('button', { name: /Open Anvaya Web App team chat/i }).click()
  await expect(page.getByRole('complementary', { name: 'Team chat' })).toBeVisible()
  await page.getByLabel('Team chat message').fill('Ship the board today')
  // Wait for the create-message request to finish before reacting. The message text
  // appears optimistically, so visibility alone can race the server-assigned message ID.
  const sendResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith('/projects/project-1/chat')
  )
  await page.getByRole('button', { name: 'Send message' }).click()
  await sendResponse
  await expect(page.getByText('Ship the board today')).toBeVisible()
  await page.getByRole('button', { name: /React 👍/i }).click()
  await expect(page.getByText('👍 1')).toBeVisible()
})

test('global command palette and reports use live project intelligence', async ({ page }) => {
  await seedLiveSession(page)
  await routeApi(page)
  await page.goto('/')

  await page.keyboard.press('Control+k')
  await expect(page.locator('.command-palette')).toBeVisible()
  await page.getByRole('textbox', { name: 'Global search' }).fill('board')
  await expect(page.getByText('Build live task board')).toBeVisible()

  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Reports', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Project performance' })).toBeVisible()
  await expect(page.getByText('Completion rate')).toBeVisible()
  await expect(page.getByText('50%')).toBeVisible()
})

test('login screen supports account creation and demo exit returns to login', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Work with clarity/i })).toBeVisible()

  await page.getByRole('button', { name: /Create an account/i }).click()
  await expect(page.getByRole('heading', { name: /Create your workspace account/i })).toBeVisible()
  await expect(page.getByLabel('Full name')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible()

  await page.getByRole('button', { name: /Sign in/i }).last().click()
  await expect(page.getByRole('heading', { name: /Work with clarity/i })).toBeVisible()

  await page.getByRole('button', { name: /Preview demo workspace/i }).click()
  await expect(page.getByRole('button', { name: /Exit demo · Back to sign in/i })).toBeVisible()
  await page.getByRole('button', { name: /Exit demo · Back to sign in/i }).click()
  await expect(page.getByRole('heading', { name: /Work with clarity/i })).toBeVisible()
})

async function routeEmptyLiveWorkspace(page) {
  return page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace('/api/v1', '')
    const json = async (status, data) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data }),
    })

    if (request.method() === 'GET' && path === '/dashboard/summary') return json(200, { activeProjects: 0, openTasks: 0, completedTasks: 0, overdueTasks: 0 })
    if (request.method() === 'GET' && path === '/projects') return json(200, [])
    if (request.method() === 'GET' && path === '/activity') return json(200, [])
    if (request.method() === 'GET' && path === '/notifications') return json(200, [])
    if (request.method() === 'GET' && path === '/invitations') return json(200, [])
    if (request.method() === 'GET' && path === '/auth/me') return json(200, { id: 'test-user', name: 'test1', email: 'test1@example.com', role: 'TEAM_MEMBER', status: 'ACTIVE' })
    return json(200, [])
  })
}

test('new live user sees only real account data when workspace is empty', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('teamflow_token', 'test-token')
    localStorage.setItem('teamflow_user', JSON.stringify({ id: 'test-user', name: 'test1', email: 'test1@example.com', role: 'TEAM_MEMBER' }))
    localStorage.removeItem('teamflow_demo')
  })
  await routeEmptyLiveWorkspace(page)
  await page.goto('/')

  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), test1/i })).toBeVisible()
  await expect(page.getByText('No projects yet.', { exact: false })).toBeVisible()
  await expect(page.getByText('Anvaya Web App')).not.toBeVisible()
  await page.getByRole('button', { name: 'Team', exact: true }).click()
  await expect(page.getByText(/No projects are available yet/i)).toBeVisible()
})
