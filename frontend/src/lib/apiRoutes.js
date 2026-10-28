// Pure URL mapping so PostgreSQL API routing can be tested without a browser.
export function routePath(path, postgresEnabled = false) {
  if (!postgresEnabled) return path
  if (path === '/projects' || path.startsWith('/projects?')) return path.replace(/^\/projects/, '/postgres/projects')
  if (path.startsWith('/projects/')) {
    const invitation = path.match(/^\/projects\/([^/]+)\/invitations(.*)$/)
    if (invitation) return '/postgres/invitations/project/' + invitation[1] + invitation[2]
    if (/^\/projects\/[^/]+\/labels(?:\/|$)/.test(path)) return path.replace(/^\/projects/, '/postgres/projects')
    if (/^\/projects\/[^/]+\/members(?:\/|$)/.test(path)) return path.replace(/^\/projects/, '/postgres/projects')
    if (/^\/projects\/[^/]+\/chat(?:\/|$)/.test(path)) return path.replace(/^\/projects/, '/postgres/projects')
    if (/^\/projects\/[^/]+\/(analytics|insights|activity|assignment-suggestions)(?:\?|$)/.test(path)) return path.replace(/^\/projects/, '/postgres/projects')
    if (/^\/projects\/[^/]+$/.test(path)) return path.replace(/^\/projects/, '/postgres/projects')
  }
  if (path.startsWith('/tasks/')) return path.replace(/^\/tasks/, '/postgres/tasks')
  if (path.startsWith('/invitations')) return path.replace(/^\/invitations$/, '/postgres/invitations/mine').replace(/^\/invitations\//, '/postgres/invitations/')
  if (path === '/settings/preferences') return '/postgres/settings/preferences'
  if (path === '/dashboard/summary') return '/postgres/dashboard/summary'
  if (path.startsWith('/search')) return path.replace(/^\/search/, '/postgres/search')
  if (path.startsWith('/comments/tasks/')) return path.replace(/^\/comments\/tasks\//, '/postgres/tasks/')
  if (path === '/activity') return '/postgres/activity'
  if (path === '/notifications') return '/postgres/notifications'
  if (/^\/notifications\/[^/]+\/read$/.test(path)) return path.replace(/^\/notifications/, '/postgres/notifications')
  return path
}
