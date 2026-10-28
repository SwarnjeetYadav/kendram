import { ApiError } from '../utils/apiError.js'
import { validateLegacyMongoId } from './postgresTaskMapping.service.js'

async function resolveUser(client, userId) {
  const id = validateLegacyMongoId(userId, 'user id')
  const result = await client.query(
    "SELECT id, legacy_mongo_id, role FROM users WHERE legacy_mongo_id = $1 AND status = 'ACTIVE'",
    [id],
  )
  if (!result.rows[0]) throw new ApiError(403, 'Your account is not mapped to PostgreSQL')
  return result.rows[0]
}

async function accessibleProjectIds(client, user) {
  const result = await client.query(
    `SELECT p.id, p.legacy_mongo_id
       FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
      WHERE ($2 = 'ADMINISTRATOR' OR p.owner_id = $1 OR pm.user_id IS NOT NULL)`,
    [user.id, user.role],
  )
  return result.rows
}

export async function getPostgresDashboard({ pool, userId }) {
  const client = await pool.connect()
  try {
    const user = await resolveUser(client, userId)
    const result = await client.query(
      `SELECT
         COUNT(DISTINCT p.id) FILTER (WHERE p.status IN ('PLANNING','ACTIVE'))::int AS active_projects,
         COUNT(t.id) FILTER (WHERE NOT COALESCE(c.is_done, false))::int AS open_tasks,
         COUNT(t.id) FILTER (WHERE COALESCE(c.is_done, false))::int AS completed_tasks,
         COUNT(t.id) FILTER (WHERE NOT COALESCE(c.is_done, false) AND t.due_date < now())::int AS overdue_tasks
       FROM projects p
       LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=$1
       LEFT JOIN boards b ON b.project_id=p.id
       LEFT JOIN tasks t ON t.board_id=b.id
       LEFT JOIN board_columns c ON c.id=t.column_id
       WHERE ($2='ADMINISTRATOR' OR p.owner_id=$1 OR pm.user_id IS NOT NULL)`,
      [user.id, user.role],
    )
    return {
      activeProjects: result.rows[0].active_projects,
      openTasks: result.rows[0].open_tasks,
      completedTasks: result.rows[0].completed_tasks,
      overdueTasks: result.rows[0].overdue_tasks,
    }
  } finally {
    client.release()
  }
}

export async function searchPostgresWorkspace({ pool, userId, query = '', scope = 'workspace' }) {
  const term = String(query || '').trim().slice(0, 120)
  if (!term) return []
  if (!['workspace', 'projects', 'tasks'].includes(scope)) throw new ApiError(400, 'Invalid search scope')
  const client = await pool.connect()
  try {
    const user = await resolveUser(client, userId)
    const pattern = '%' + term + '%'
    const results = []
    if (scope !== 'tasks') {
      const projects = await client.query(
        `SELECT p.id, p.legacy_mongo_id, p.name, p.description, p.status, p.updated_at
           FROM projects p
           LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=$1
          WHERE ($2='ADMINISTRATOR' OR p.owner_id=$1 OR pm.user_id IS NOT NULL)
            AND (p.name ILIKE $3 OR p.description ILIKE $3)
          ORDER BY p.updated_at DESC LIMIT 25`,
        [user.id, user.role, pattern],
      )
      results.push(...projects.rows.map(row => ({ type: 'PROJECT', id: row.legacy_mongo_id || row.id, title: row.name, description: row.description, status: row.status, updatedAt: row.updated_at })))
    }
    if (scope !== 'projects') {
      const tasks = await client.query(
        `SELECT t.id, t.title, t.description, t.priority, t.due_date, t.updated_at,
                p.legacy_mongo_id AS project_legacy_id, p.name AS project_name,
                c.name AS status
           FROM tasks t
           JOIN boards b ON b.id=t.board_id
           JOIN projects p ON p.id=b.project_id
           JOIN board_columns c ON c.id=t.column_id
           LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=$1
          WHERE ($2='ADMINISTRATOR' OR p.owner_id=$1 OR pm.user_id IS NOT NULL)
            AND (t.title ILIKE $3 OR t.description ILIKE $3)
          ORDER BY t.updated_at DESC LIMIT 25`,
        [user.id, user.role, pattern],
      )
      results.push(...tasks.rows.map(row => ({ type: 'TASK', id: row.id, title: row.title, description: row.description, priority: row.priority, status: row.status, projectId: row.project_legacy_id, projectName: row.project_name, dueDate: row.due_date, updatedAt: row.updated_at })))
    }
    return results.slice(0, 50)
  } finally {
    client.release()
  }
}

export async function listPostgresActivity({ pool, userId, limit = 50, projectId = null }) {
  const client = await pool.connect()
  try {
    const user = await resolveUser(client, userId)
    const safeLimit = Math.max(1, Math.min(Number.parseInt(limit, 10) || 50, 100))
    const legacyProjectId = projectId == null ? null : validateLegacyMongoId(projectId, 'project id')
    const result = await client.query(
      `WITH combined_activity AS (
         SELECT a.id::text AS id, a.action, a.before_state, a.after_state, a.created_at,
                p.id AS project_sql_id, p.legacy_mongo_id AS project_legacy_id, p.name AS project_name,
                t.id::text AS task_id, t.title AS task_title,
                actor.legacy_mongo_id AS actor_legacy_id, actor.name AS actor_name,
                '{}'::jsonb AS metadata
           FROM activity_history a
           JOIN projects p ON p.id=a.project_id
           JOIN users actor ON actor.id=a.actor_id
           LEFT JOIN tasks t ON t.id=a.task_id
         UNION ALL
         SELECT a.id::text AS id, a.action, NULL::jsonb AS before_state, NULL::jsonb AS after_state, a.created_at,
                p.id AS project_sql_id, p.legacy_mongo_id AS project_legacy_id, p.name AS project_name,
                t.id::text AS task_id, t.title AS task_title,
                actor.legacy_mongo_id AS actor_legacy_id, actor.name AS actor_name,
                a.metadata
           FROM activity_logs a
           JOIN projects p ON a.entity_type='PROJECT' AND p.id=a.entity_id
           JOIN users actor ON actor.id=a.user_id
           LEFT JOIN tasks t ON t.id::text=a.metadata->>'taskId'
       )
       SELECT a.*
         FROM combined_activity a
         LEFT JOIN project_members pm ON pm.project_id=a.project_sql_id AND pm.user_id=$1
        WHERE ($2='ADMINISTRATOR' OR EXISTS (
          SELECT 1 FROM projects p2 WHERE p2.id=a.project_sql_id AND p2.owner_id=$1
        ) OR pm.user_id IS NOT NULL)
          AND ($4::text IS NULL OR a.project_legacy_id=$4)
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $3`,
      [user.id, user.role, safeLimit, legacyProjectId],
    )
    return result.rows.map(row => ({
      id: String(row.id), action: row.action, createdAt: row.created_at,
      project: { id: row.project_legacy_id, name: row.project_name },
      task: row.task_id ? { id: row.task_id, title: row.task_title } : null,
      user: { id: row.actor_legacy_id, name: row.actor_name },
      before: row.before_state, after: row.after_state, metadata: row.metadata,
    }))
  } finally {
    client.release()
  }
}


export async function getPostgresProjectAnalytics({ pool, userId, projectId }) {
  const client = await pool.connect()
  try {
    const user = await resolveUser(client, userId)
    const legacyProjectId = validateLegacyMongoId(projectId, 'project id')
    const access = await client.query(
      `SELECT p.id,p.name,p.legacy_mongo_id
         FROM projects p LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=$1
        WHERE p.legacy_mongo_id=$2 AND ($3='ADMINISTRATOR' OR p.owner_id=$1 OR pm.user_id IS NOT NULL)`,
      [user.id, legacyProjectId, user.role],
    )
    if (!access.rows[0]) throw new ApiError(404, 'Project not found or not accessible')
    const project = access.rows[0]
    const totalsResult = await client.query(
      `SELECT COUNT(t.id)::int AS total,
              COUNT(t.id) FILTER (WHERE c.is_done)::int AS completed,
              COUNT(t.id) FILTER (WHERE NOT COALESCE(c.is_done,false))::int AS open,
              COUNT(t.id) FILTER (WHERE NOT COALESCE(c.is_done,false) AND t.due_date < CURRENT_DATE)::int AS overdue,
              COUNT(t.id) FILTER (WHERE upper(replace(c.name,' ','_'))='BLOCKED')::int AS blocked
         FROM boards b LEFT JOIN tasks t ON t.board_id=b.id LEFT JOIN board_columns c ON c.id=t.column_id
        WHERE b.project_id=$1`, [project.id])
    const statusesResult = await client.query(
      `SELECT c.name AS status,COUNT(t.id)::int AS count
         FROM boards b JOIN board_columns c ON c.board_id=b.id
         LEFT JOIN tasks t ON t.column_id=c.id
        WHERE b.project_id=$1 GROUP BY c.id,c.name,c.position ORDER BY c.position`, [project.id])
    const prioritiesResult = await client.query(
      `SELECT t.priority,COUNT(*)::int AS count FROM tasks t JOIN boards b ON b.id=t.board_id
        WHERE b.project_id=$1 GROUP BY t.priority ORDER BY t.priority`, [project.id])
    const monthlyResult = await client.query(
      `SELECT to_char(date_trunc('month',t.created_at),'YYYY-MM') AS month,COUNT(*)::int AS created
         FROM tasks t JOIN boards b ON b.id=t.board_id WHERE b.project_id=$1 AND t.created_at>=now()-interval '6 months'
        GROUP BY date_trunc('month',t.created_at) ORDER BY date_trunc('month',t.created_at)`, [project.id])
    const throughputResult = await client.query(
      `SELECT to_char(weeks.week_start,'YYYY-MM-DD') AS week,
              COUNT(t.id) FILTER (WHERE c.is_done AND t.completed_at >= weeks.week_start AND t.completed_at < weeks.week_start + interval '1 week')::int AS completed
         FROM generate_series(date_trunc('week',now()) - interval '7 weeks', date_trunc('week',now()), interval '1 week') AS weeks(week_start)
         LEFT JOIN boards b ON b.project_id=$1
         LEFT JOIN tasks t ON t.board_id=b.id AND t.completed_at >= weeks.week_start AND t.completed_at < weeks.week_start + interval '1 week'
         LEFT JOIN board_columns c ON c.id=t.column_id
        GROUP BY weeks.week_start ORDER BY weeks.week_start`, [project.id])
    const workloadResult = await client.query(
      `SELECT u.legacy_mongo_id AS "userId",u.name,
              COUNT(t.id) FILTER (WHERE b.id IS NOT NULL AND NOT COALESCE(c.is_done,false))::int AS "activeTasks"
         FROM project_members pm JOIN users u ON u.id=pm.user_id
         LEFT JOIN tasks t ON t.assignee_id=u.id
         LEFT JOIN boards b ON b.id=t.board_id AND b.project_id=pm.project_id
         LEFT JOIN board_columns c ON c.id=t.column_id
        WHERE pm.project_id=$1
        GROUP BY u.id,u.legacy_mongo_id,u.name ORDER BY u.name`, [project.id])
    const dependencyResult = await client.query(
      'SELECT COUNT(*)::int AS count FROM task_dependencies WHERE project_id=$1', [project.id])
    const cycleResult = await client.query(
      `SELECT COALESCE(round((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.completed_at-t.started_at))/3600))::numeric,1),0)::float AS hours
         FROM tasks t JOIN boards b ON b.id=t.board_id
        WHERE b.project_id=$1 AND t.started_at IS NOT NULL AND t.completed_at IS NOT NULL AND t.completed_at>=t.started_at`, [project.id])
    const total = totalsResult.rows[0]
    const totalTasks = Number(total.total || 0)
    const completedTasks = Number(total.completed || 0)
    const overdueTasks = Number(total.overdue || 0)
    const workload = workloadResult.rows.map((row) => ({ ...row, userId: row.userId || null, activeTasks: Number(row.activeTasks || 0) }))
    const loads = workload.map((row) => row.activeTasks)
    const workloadSpread = loads.length ? Math.max(...loads) - Math.min(...loads) : 0
    const throughput = throughputResult.rows.map((row) => ({ ...row, completed: Number(row.completed || 0) }))
    return {
      projectId: project.legacy_mongo_id,
      projectName: project.name,
      totalTasks,
      completedTasks,
      completionRate: totalTasks ? Math.round(completedTasks * 100 / totalTasks) : 0,
      overdueTasks,
      overdueRate: totalTasks ? Math.round(overdueTasks * 100 / totalTasks) : 0,
      blockedTasks: Number(total.blocked || 0),
      dependencyCount: Number(dependencyResult.rows[0]?.count || 0),
      medianCycleTimeHours: Number(cycleResult.rows[0]?.hours || 0),
      workload,
      workloadSpread,
      throughput,
      totals: { total: totalTasks, completed: completedTasks, open: Number(total.open || 0), overdue: overdueTasks,
        completionRate: totalTasks ? Math.round(completedTasks * 100 / totalTasks) : 0 },
      byStatus: statusesResult.rows,
      byPriority: prioritiesResult.rows,
      tasksCreatedByMonth: monthlyResult.rows,
    }
  } finally {
    client.release()
  }
}

export async function getPostgresProjectInsights({ pool, userId, projectId }) {
  const analytics = await getPostgresProjectAnalytics({ pool, userId, projectId })
  const insights = []
  if (analytics.totals.overdue > 0) insights.push({ type:'WARNING', code:'OVERDUE_TASKS', message: analytics.totals.overdue + ' task(s) are overdue.' })
  if (analytics.totals.total > 0 && analytics.totals.completionRate < 25) insights.push({ type:'INFO', code:'LOW_COMPLETION', message:'Less than 25% of project tasks are complete.' })
  const unassigned = await pool.query(
    `SELECT COUNT(t.id)::int AS count FROM tasks t JOIN boards b ON b.id=t.board_id JOIN projects p ON p.id=b.project_id
      WHERE p.legacy_mongo_id=$1 AND t.assignee_id IS NULL`, [validateLegacyMongoId(projectId,'project id')])
  if (unassigned.rows[0].count > 0) insights.push({ type:'INFO', code:'UNASSIGNED_TASKS', message: unassigned.rows[0].count + ' task(s) do not have an assignee.' })
  if (!insights.length) insights.push({ type:'SUCCESS', code:'ON_TRACK', message:'No immediate task-risk signals were found in the current PostgreSQL data.' })
  return { projectId: analytics.projectId, generatedAt: new Date().toISOString(), insights }
}
