import 'dotenv/config'
import mongoose from 'mongoose'
import pg from 'pg'
import User from '../models/User.js'
import Project from '../models/Project.js'
import Task from '../models/Task.js'
import Comment from '../models/Comment.js'
import ProjectMember from '../models/ProjectMember.js'
import TaskDependency from '../models/TaskDependency.js'
import Invitation from '../models/Invitation.js'
import ProjectMessage from '../models/ProjectMessage.js'
import ActivityLog from '../models/ActivityLog.js'
import Notification from '../models/Notification.js'

const { Pool } = pg
const apply = process.argv.includes('--apply')
const mongoUri = process.env.MONGODB_URI?.trim()
const databaseUrl = process.env.DATABASE_URL?.trim()

if (!mongoUri || !databaseUrl) {
  console.error('Configuration error: MONGODB_URI and DATABASE_URL are required.')
  process.exit(2)
}
if (apply) {
  const targetDatabase = (() => {
    try { return decodeURIComponent(new URL(databaseUrl).pathname.slice(1)) } catch { return '' }
  })()
  const confirmedDatabase = process.env.POSTGRES_IMPORT_DATABASE?.trim()
  const safeName = /(?:^|[_-])(dev|test|staging)(?:$|[_-])/i.test(targetDatabase)
  const forbiddenName = /prod(?:uction)?|live/i.test(targetDatabase)
  if (process.env.POSTGRES_IMPORT_CONFIRM !== 'true'
    || process.env.POSTGRES_IMPORT_TARGET !== 'staging'
    || !confirmedDatabase
    || confirmedDatabase !== targetDatabase
    || !safeName
    || forbiddenName) {
    console.error('Refusing to write. Confirm a non-production database explicitly: set POSTGRES_IMPORT_CONFIRM=true, POSTGRES_IMPORT_TARGET=staging, and POSTGRES_IMPORT_DATABASE to the exact database name in DATABASE_URL (which must be clearly named dev/test/staging), then pass --apply.')
    process.exit(2)
  }
}

const normalize = value => String(value || '').trim().toLowerCase()
const validProjectStatuses = new Set(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'])
const validTaskStatuses = new Set(['TODO', 'IN_PROGRESS', 'REVIEW', 'BLOCKED', 'COMPLETED'])
const validPriorities = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
const statusColumn = {
  TODO: { name: 'To Do', position: 0, isDone: false },
  IN_PROGRESS: { name: 'In Progress', position: 1, isDone: false },
  REVIEW: { name: 'Review', position: 2, isDone: false },
  BLOCKED: { name: 'Blocked', position: 3, isDone: false },
  COMPLETED: { name: 'Done', position: 4, isDone: true },
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 2,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000,
  ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
})

async function main() {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 })
  try {
    const [users, projects, tasks, comments, memberships, dependencies, invitations, messages, activityLogs, notifications] = await Promise.all([
      User.find({}).select('_id').lean(),
      Project.find({}).lean(),
      Task.find({}).lean(),
      Comment.find({}).lean(),
      ProjectMember.find({}).lean(),
      TaskDependency.find({}).lean(),
      Invitation.find({}).lean(),
      ProjectMessage.find({}).lean(),
      ActivityLog.find({}).lean(),
      Notification.find({}).lean(),
    ])
    const client = await pool.connect()
    try {
      const migration = await client.query("SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ready")
      if (!migration.rows[0].ready) throw new Error('PostgreSQL schema_migrations is missing.')
      const tableChecks = await client.query(
        "SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='legacy_mongo_id'",
      )
      const legacyTables = new Set(tableChecks.rows.map(row => row.table_name))
      for (const table of ['users', 'projects', 'tasks', 'comments']) {
        if (!legacyTables.has(table)) throw new Error(`Required legacy_mongo_id column is missing from public.${table}.`)
      }

      // A single pg Client must execute queries sequentially; Promise.all on
      // one client can queue overlapping operations and emits pg deprecation warnings.
      const sqlUsersResult = await client.query('SELECT id,email,legacy_mongo_id FROM users')
      const sqlProjectsResult = await client.query('SELECT id,name,owner_id,legacy_mongo_id FROM projects')
      const sqlTasksResult = await client.query('SELECT id,title,legacy_mongo_id FROM tasks')
      const sqlCommentsResult = await client.query('SELECT id,legacy_mongo_id FROM comments')
      const sqlUsers = sqlUsersResult.rows
      const sqlProjects = sqlProjectsResult.rows
      const sqlTasks = sqlTasksResult.rows
      const sqlComments = sqlCommentsResult.rows
      const userByLegacy = new Map(sqlUsers.filter(x => x.legacy_mongo_id).map(x => [String(x.legacy_mongo_id), x]))
      const projectByLegacy = new Map(sqlProjects.filter(x => x.legacy_mongo_id).map(x => [String(x.legacy_mongo_id), x]))
      const taskByLegacy = new Map(sqlTasks.filter(x => x.legacy_mongo_id).map(x => [String(x.legacy_mongo_id), x]))
      const commentByLegacy = new Map(sqlComments.filter(x => x.legacy_mongo_id).map(x => [String(x.legacy_mongo_id), x]))
      const sourceUserIds = new Set(users.map(x => String(x._id)))
      const sourceProjectIds = new Set(projects.map(x => String(x._id)))
      const sourceTaskIds = new Set(tasks.map(x => String(x._id)))
      const blockers = []
      const warnings = []
      const plan = { projects: [], tasks: [], comments: [] }

      // Activity/notification entity IDs are polymorphic ObjectIds in
      // MongoDB. Accept only explicitly recognized TASK/PROJECT references;
      // unknown types or dangling references block the entire transaction.
      const unsupportedSourceDomains = []
      for (const [type, count] of unsupportedSourceDomains) {
        if (count > 0) blockers.push({ type, count })
      }

      const projectBySourceId = new Map(projects.map(row => [String(row._id), row]))
      const taskBySourceId = new Map(tasks.map(row => [String(row._id), row]))
      const userBySourceId = new Map(users.map(row => [String(row._id), row]))
      for (const member of memberships) {
        if (!projectBySourceId.has(String(member.projectId)) || !userBySourceId.has(String(member.userId))) {
          blockers.push({ type: 'membership_reference_missing', sourceId: String(member._id) })
        }
        if (!['PROJECT_MANAGER', 'MEMBER', 'VIEWER'].includes(member.projectRole || 'MEMBER')) {
          blockers.push({ type: 'membership_role_unsupported', sourceId: String(member._id) })
        }
      }
      for (const dependency of dependencies) {
        if (!projectBySourceId.has(String(dependency.projectId))
          || !taskBySourceId.has(String(dependency.predecessorTaskId))
          || !taskBySourceId.has(String(dependency.successorTaskId))
          || !userBySourceId.has(String(dependency.createdBy))
          || String(dependency.predecessorTaskId) === String(dependency.successorTaskId)) {
          blockers.push({ type: 'dependency_reference_invalid', sourceId: String(dependency._id) })
        }
      }
      for (const invitation of invitations) {
        if (!projectBySourceId.has(String(invitation.projectId))
          || !userBySourceId.has(String(invitation.invitedUserId))
          || !userBySourceId.has(String(invitation.invitedBy))
          || !['PROJECT_MANAGER', 'MEMBER', 'VIEWER'].includes(invitation.projectRole || 'MEMBER')
          || !['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED'].includes(invitation.status || 'PENDING')
          || !invitation.expiresAt) {
          blockers.push({ type: 'invitation_reference_or_field_invalid', sourceId: String(invitation._id) })
        }
      }
      for (const message of messages) {
        if (!projectBySourceId.has(String(message.projectId))
          || !userBySourceId.has(String(message.userId))
          || (message.taskId && !taskBySourceId.has(String(message.taskId)))
          || !String(message.message || '').trim()) {
          blockers.push({ type: 'project_message_reference_or_body_invalid', sourceId: String(message._id) })
        }
      }
      for (const activity of activityLogs) {
        const type = String(activity.entityType || '').toUpperCase()
        const entityExists = type === 'TASK'
          ? taskBySourceId.has(String(activity.entityId))
          : type === 'PROJECT'
            ? projectBySourceId.has(String(activity.entityId))
            : false
        if (!userBySourceId.has(String(activity.userId)) || !entityExists
          || !String(activity.action || '').trim()) {
          blockers.push({ type: 'activity_log_entity_or_actor_unmapped', sourceId: String(activity._id), entityType: type })
        }
      }
      for (const notification of notifications) {
        const entityId = notification.entityId ? String(notification.entityId) : null
        if (!userBySourceId.has(String(notification.userId))
          || !String(notification.type || '').trim()
          || !String(notification.message || '').trim()
          || (entityId && !taskBySourceId.has(entityId) && !projectBySourceId.has(entityId))) {
          blockers.push({ type: 'notification_recipient_or_entity_unmapped', sourceId: String(notification._id) })
        }
      }
      for (const task of tasks) {
        const labels = Array.isArray(task.labels) ? task.labels.map(value => String(value).trim()) : []
        if (labels.length > 20 || labels.some(label => !label || label.length > 32)
          || new Set(labels.map(label => label.toLowerCase())).size !== labels.length) {
          blockers.push({ type: 'task_labels_invalid_for_normalization', sourceId: String(task._id) })
        }
      }

      for (const p of projects) {
        const id = String(p._id)
        const owner = userByLegacy.get(String(p.ownerId))
        if (!sourceUserIds.has(String(p.ownerId)) || !owner) {
          blockers.push({ type: 'project_owner_not_mapped', sourceId: id })
          continue
        }
        if (!String(p.name || '').trim()) {
          blockers.push({ type: 'project_name_missing', sourceId: id })
          continue
        }
        if (projectByLegacy.has(id)) continue
        if (sqlProjects.some(x => normalize(x.name) === normalize(p.name) && String(x.owner_id) === String(owner.id))) {
          blockers.push({ type: 'project_name_owner_conflict_without_legacy_mapping', sourceId: id })
          continue
        }
        const status = validProjectStatuses.has(p.status) ? p.status : 'PLANNING'
        plan.projects.push({ id, ownerId: String(p.ownerId), name: p.name, description: p.description || '', status, startDate: p.startDate || null, dueDate: p.dueDate || null, createdAt: p.createdAt || new Date(), updatedAt: p.updatedAt || new Date() })
      }

      const plannedOrExistingProjectIds = new Set([...projectByLegacy.keys(), ...plan.projects.map(x => x.id)])
      for (const t of tasks) {
        const id = String(t._id)
        if (!sourceProjectIds.has(String(t.projectId)) || !plannedOrExistingProjectIds.has(String(t.projectId))) {
          blockers.push({ type: 'task_project_not_mapped_or_planned', sourceId: id })
          continue
        }
        if (!sourceUserIds.has(String(t.createdBy)) || !userByLegacy.has(String(t.createdBy))) {
          blockers.push({ type: 'task_creator_not_mapped', sourceId: id })
          continue
        }
        if (t.assigneeId && (!sourceUserIds.has(String(t.assigneeId)) || !userByLegacy.has(String(t.assigneeId)))) {
          blockers.push({ type: 'task_assignee_not_mapped', sourceId: id })
          continue
        }
        if (!String(t.title || '').trim()) {
          blockers.push({ type: 'task_title_missing', sourceId: id })
          continue
        }
        if (!validTaskStatuses.has(t.status)) {
          blockers.push({ type: 'unsupported_task_status', sourceId: id })
          continue
        }
        if (t.priority && !validPriorities.has(t.priority)) {
          blockers.push({ type: 'unsupported_task_priority', sourceId: id })
          continue
        }
        if (taskByLegacy.has(id)) continue
        if (sqlTasks.some(x => normalize(x.title) === normalize(t.title) && !x.legacy_mongo_id)) {
          warnings.push({ type: 'same_title_unmapped_target_task_preserved', sourceId: id })
        }
        plan.tasks.push({
          id, projectId: String(t.projectId), createdBy: String(t.createdBy),
          assigneeId: t.assigneeId ? String(t.assigneeId) : null,
          title: t.title, status: t.status, priority: t.priority || 'MEDIUM',
        })
      }

      for (const c of comments) {
        const id = String(c._id)
        if (!sourceTaskIds.has(String(c.taskId)) || !tasks.some(t => String(t._id) === String(c.taskId))) {
          blockers.push({ type: 'comment_task_missing', sourceId: id })
          continue
        }
        if (!sourceUserIds.has(String(c.userId)) || !userByLegacy.has(String(c.userId))) {
          blockers.push({ type: 'comment_author_not_mapped', sourceId: id })
          continue
        }
        if (!String(c.message || '').trim()) {
          blockers.push({ type: 'comment_message_missing', sourceId: id })
          continue
        }
        if (!taskByLegacy.has(String(c.taskId)) && !plan.tasks.some(t => t.id === String(c.taskId))) {
          blockers.push({ type: 'comment_task_not_mapped_or_planned', sourceId: id })
          continue
        }
        if (commentByLegacy.has(id)) continue
        plan.comments.push({ id, taskId: String(c.taskId), userId: String(c.userId) })
      }

      const report = {
        reportType: 'postgres-application-entity-migration',
        mode: apply ? 'APPLY_STAGING' : 'DRY_RUN',
        sourceCounts: { users: users.length, projects: projects.length, tasks: tasks.length, comments: comments.length, memberships: memberships.length, dependencies: dependencies.length, invitations: invitations.length, projectMessages: messages.length, activityLogs: activityLogs.length, notifications: notifications.length },
        alreadyMapped: {
          projects: projects.filter(x => projectByLegacy.has(String(x._id))).length,
          tasks: tasks.filter(x => taskByLegacy.has(String(x._id))).length,
          comments: comments.filter(x => commentByLegacy.has(String(x._id))).length,
        },
        plannedInserts: { projects: plan.projects.length, tasks: plan.tasks.length, comments: plan.comments.length },
        sourceDomainRecordsToReconcile: {
          memberships: memberships.length, dependencies: dependencies.length, invitations: invitations.length,
          projectMessages: messages.length, activityLogs: activityLogs.length, notifications: notifications.length,
          taskLabelLinkCandidates: tasks.reduce((total, task) => total + (Array.isArray(task.labels) ? task.labels.length : 0), 0),
        },
        blockers, warnings, writesPerformed: false,
        note: 'This staging-only importer preserves existing SQL demo rows and imports projects, tasks, comments, memberships, dependencies, invitations, project messages, and normalized task labels. Activity and notification entity IDs are mapped only for recognized TASK/PROJECT references; unknown/dangling references block the import. Review the dry run before apply.',
      }

      if (blockers.length) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n')
        process.exitCode = 1
        return
      }
      if (!apply) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n')
        return
      }

      await client.query('BEGIN')
      try {
        // Recheck all mapped IDs under transaction before writes.
        for (const p of plan.projects) {
          const exists = await client.query('SELECT id FROM projects WHERE legacy_mongo_id=$1 FOR UPDATE', [p.id])
          if (exists.rowCount) throw new Error('Target project mapping changed after dry run; rollback and re-run preflight.')
        }
        for (const t of plan.tasks) {
          const exists = await client.query('SELECT id FROM tasks WHERE legacy_mongo_id=$1 FOR UPDATE', [t.id])
          if (exists.rowCount) throw new Error('Target task mapping changed after dry run; rollback and re-run preflight.')
        }
        for (const c of plan.comments) {
          const exists = await client.query('SELECT id FROM comments WHERE legacy_mongo_id=$1 FOR UPDATE', [c.id])
          if (exists.rowCount) throw new Error('Target comment mapping changed after dry run; rollback and re-run preflight.')
        }

        const targetUserByLegacy = new Map()
        for (const u of users) {
          const result = await client.query('SELECT id FROM users WHERE legacy_mongo_id=$1', [String(u._id)])
          if (!result.rowCount) throw new Error('A source user is not mapped in PostgreSQL; run and verify the user migration first.')
          targetUserByLegacy.set(String(u._id), result.rows[0].id)
        }
        const targetProjectByLegacy = new Map(projectByLegacy)
        for (const p of plan.projects) {
          const ownerId = targetUserByLegacy.get(p.ownerId)
          const inserted = await client.query(
            `INSERT INTO projects (name,description,owner_id,status,start_date,due_date,legacy_mongo_id,created_at,updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
            [p.name, p.description || '', ownerId, p.status, p.startDate || null, p.dueDate || null, p.id, p.createdAt || new Date(), p.updatedAt || new Date()],
          )
          targetProjectByLegacy.set(p.id, inserted.rows[0])
          await client.query(
            `INSERT INTO project_members (project_id,user_id,project_role)
             VALUES ($1,$2,'PROJECT_MANAGER') ON CONFLICT (project_id,user_id) DO NOTHING`,
            [inserted.rows[0].id, ownerId],
          )
        }

        const targetProjectIds = new Map()
        for (const p of projects) {
          if (targetProjectByLegacy.has(String(p._id))) targetProjectIds.set(String(p._id), targetProjectByLegacy.get(String(p._id)).id)
          else {
            const result = await client.query('SELECT id FROM projects WHERE legacy_mongo_id=$1', [String(p._id)])
            if (!result.rowCount) throw new Error('Project mapping missing after insert.')
            targetProjectIds.set(String(p._id), result.rows[0].id)
          }
        }

        const boardByProject = new Map()
        const columnByProjectStatus = new Map()
        for (const p of projects) {
          const projectId = targetProjectIds.get(String(p._id))
          let boardResult = await client.query('SELECT id FROM boards WHERE project_id=$1 AND name=$2', [projectId, 'Imported MongoDB Board'])
          let boardId
          if (boardResult.rowCount) boardId = boardResult.rows[0].id
          else {
            const ownerId = targetUserByLegacy.get(String(p.ownerId))
            boardResult = await client.query(
              'INSERT INTO boards (project_id,name,description,created_by) VALUES ($1,$2,$3,$4) RETURNING id',
              [projectId, 'Imported MongoDB Board', 'Board created during MongoDB-to-PostgreSQL staging migration', ownerId],
            )
            boardId = boardResult.rows[0].id
          }
          boardByProject.set(String(p._id), boardId)
          for (const column of Object.values(statusColumn)) {
            const result = await client.query(
              `INSERT INTO board_columns (board_id,name,position,is_done)
               VALUES ($1,$2,$3,$4)
               ON CONFLICT (board_id,name) DO UPDATE SET position=EXCLUDED.position,is_done=EXCLUDED.is_done
               RETURNING id`,
              [boardId, column.name, column.position, column.isDone],
            )
            columnByProjectStatus.set(`${String(p._id)}:${Object.keys(statusColumn).find(k => statusColumn[k] === column)}`, result.rows[0].id)
          }
        }

        const targetTaskByLegacy = new Map()
        for (const t of tasks) {
          const existing = await client.query('SELECT id FROM tasks WHERE legacy_mongo_id=$1', [String(t._id)])
          if (existing.rowCount) {
            targetTaskByLegacy.set(String(t._id), existing.rows[0].id)
            continue
          }
          const boardId = boardByProject.get(String(t.projectId))
          const columnId = columnByProjectStatus.get(`${String(t.projectId)}:${t.status}`)
          const createdBy = targetUserByLegacy.get(String(t.createdBy))
          const assigneeId = t.assigneeId ? targetUserByLegacy.get(String(t.assigneeId)) : null
          const inserted = await client.query(
            `INSERT INTO tasks
              (board_id,column_id,title,description,priority,assignee_id,created_by,due_date,position,version,legacy_mongo_id,created_at,updated_at,estimate_minutes,started_at,completed_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
            [boardId, columnId, t.title, t.description || '', t.priority || 'MEDIUM', assigneeId, createdBy, t.dueDate || null,
              (t.position ?? 0), t.version || 1, String(t._id), t.createdAt || new Date(), t.updatedAt || new Date(),
              t.estimateMinutes || null, t.startedAt || null, t.completedAt || null],
          )
          targetTaskByLegacy.set(String(t._id), inserted.rows[0].id)
          const projectId = targetProjectIds.get(String(t.projectId))
          await client.query(
            `INSERT INTO activity_history (project_id,task_id,actor_id,action,after_state,created_at)
             VALUES ($1,$2,$3,'TASK_IMPORTED',$4::jsonb,$5)`,
            [projectId, inserted.rows[0].id, createdBy, JSON.stringify({ source: 'MongoDB', legacyMongoId: String(t._id) }), t.createdAt || new Date()],
          )
        }

        for (const c of comments) {
          const existing = await client.query('SELECT id FROM comments WHERE legacy_mongo_id=$1', [String(c._id)])
          if (existing.rowCount) continue
          const taskId = targetTaskByLegacy.get(String(c.taskId))
          const authorId = targetUserByLegacy.get(String(c.userId))
          if (!taskId || !authorId) throw new Error('Comment task or author mapping is missing; rolling back.')
          await client.query(
            `INSERT INTO comments (task_id,author_id,body,legacy_mongo_id,created_at,updated_at)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [taskId, authorId, c.message, String(c._id), c.createdAt || new Date(), c.updatedAt || new Date()],
          )
        }
        // Import membership records with their source IDs. Project owners
        // created above are also represented by MongoDB ProjectMember records
        // when present; the composite key prevents duplicate membership rows.
        for (const member of memberships) {
          const sourceId = String(member._id)
          const projectId = targetProjectIds.get(String(member.projectId))
          const userId = targetUserByLegacy.get(String(member.userId))
          if (!projectId || !userId) throw new Error(`Membership mapping missing for ${sourceId}; rolling back.`)
          const existing = await client.query('SELECT project_id,user_id FROM project_members WHERE legacy_mongo_id=$1', [sourceId])
          if (existing.rowCount) continue
          await client.query(
            `INSERT INTO project_members (project_id,user_id,project_role,joined_at,legacy_mongo_id)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (project_id,user_id) DO UPDATE SET
               project_role=EXCLUDED.project_role,
               legacy_mongo_id=COALESCE(project_members.legacy_mongo_id, EXCLUDED.legacy_mongo_id)`,
            [projectId, userId, member.projectRole || 'MEMBER', member.joinedAt || member.createdAt || new Date(), sourceId],
          )
        }

        // Normalize embedded task labels into per-board labels and task links.
        for (const task of tasks) {
          const taskId = targetTaskByLegacy.get(String(task._id))
          const boardId = boardByProject.get(String(task.projectId))
          if (!taskId || !boardId) throw new Error(`Task label mapping missing for ${String(task._id)}; rolling back.`)
          for (const rawLabel of (Array.isArray(task.labels) ? task.labels : [])) {
            const labelName = String(rawLabel).trim()
            const labelResult = await client.query(
              `INSERT INTO labels (board_id,name,color) VALUES ($1,$2,$3)
               ON CONFLICT (board_id,name) DO UPDATE SET name=EXCLUDED.name
               RETURNING id`,
              [boardId, labelName, '#64748b'],
            )
            await client.query(
              'INSERT INTO task_labels (task_id,label_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
              [taskId, labelResult.rows[0].id],
            )
          }
        }

        // Dependency edges are idempotent by source ID and by relational edge.
        for (const dependency of dependencies) {
          const sourceId = String(dependency._id)
          const existing = await client.query('SELECT id FROM task_dependencies WHERE legacy_mongo_id=$1', [sourceId])
          if (existing.rowCount) continue
          const projectId = targetProjectIds.get(String(dependency.projectId))
          const predecessorId = targetTaskByLegacy.get(String(dependency.predecessorTaskId))
          const successorId = targetTaskByLegacy.get(String(dependency.successorTaskId))
          const createdBy = targetUserByLegacy.get(String(dependency.createdBy))
          if (!projectId || !predecessorId || !successorId || !createdBy) {
            throw new Error(`Dependency mapping missing for ${sourceId}; rolling back.`)
          }
          await client.query(
            `INSERT INTO task_dependencies
             (project_id,predecessor_task_id,successor_task_id,created_by,legacy_mongo_id,created_at,updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (project_id,predecessor_task_id,successor_task_id)
             DO UPDATE SET legacy_mongo_id=COALESCE(task_dependencies.legacy_mongo_id, EXCLUDED.legacy_mongo_id)`,
            [projectId, predecessorId, successorId, createdBy, sourceId, dependency.createdAt || new Date(), dependency.updatedAt || new Date()],
          )
        }

        for (const invitation of invitations) {
          const sourceId = String(invitation._id)
          const existing = await client.query('SELECT id FROM invitations WHERE legacy_mongo_id=$1', [sourceId])
          if (existing.rowCount) continue
          const projectId = targetProjectIds.get(String(invitation.projectId))
          const invitedUserId = targetUserByLegacy.get(String(invitation.invitedUserId))
          const invitedBy = targetUserByLegacy.get(String(invitation.invitedBy))
          if (!projectId || !invitedUserId || !invitedBy) throw new Error(`Invitation mapping missing for ${sourceId}; rolling back.`)
          await client.query(
            `INSERT INTO invitations
             (project_id,invited_user_id,project_role,status,expires_at,invited_by,legacy_mongo_id,created_at,updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [projectId, invitedUserId, invitation.projectRole || 'MEMBER', invitation.status || 'PENDING',
              invitation.expiresAt, invitedBy, sourceId, invitation.createdAt || new Date(), invitation.updatedAt || new Date()],
          )
        }

        const targetMessageByLegacy = new Map()
        for (const message of messages) {
          const sourceId = String(message._id)
          const existing = await client.query('SELECT id FROM project_messages WHERE legacy_mongo_id=$1', [sourceId])
          if (existing.rowCount) {
            targetMessageByLegacy.set(sourceId, existing.rows[0].id)
            continue
          }
          const projectId = targetProjectIds.get(String(message.projectId))
          const userId = targetUserByLegacy.get(String(message.userId))
          const taskId = message.taskId ? targetTaskByLegacy.get(String(message.taskId)) : null
          if (!projectId || !userId || (message.taskId && !taskId)) throw new Error(`Message mapping missing for ${sourceId}; rolling back.`)
          const mentions = (Array.isArray(message.mentions) ? message.mentions : []).map(id => targetUserByLegacy.get(String(id)))
          if (mentions.some(id => !id)) throw new Error(`Message mention mapping missing for ${sourceId}; rolling back.`)
          const reactions = (Array.isArray(message.reactions) ? message.reactions : []).map(reaction => ({
            userId: targetUserByLegacy.get(String(reaction.userId)),
            emoji: reaction.emoji,
          }))
          if (reactions.some(reaction => !reaction.userId)) throw new Error(`Message reaction mapping missing for ${sourceId}; rolling back.`)
          const inserted = await client.query(
            `INSERT INTO project_messages
             (project_id,user_id,message,task_id,mentions,reactions,legacy_mongo_id,created_at,updated_at)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9) RETURNING id`,
            [projectId, userId, String(message.message).trim(), taskId, JSON.stringify(mentions), JSON.stringify(reactions),
              sourceId, message.createdAt || new Date(), message.updatedAt || new Date()],
          )
          targetMessageByLegacy.set(sourceId, inserted.rows[0].id)
        }
        // Resolve replies in a second pass so source ordering does not matter.
        for (const message of messages) {
          if (!message.replyToId) continue
          const targetId = targetMessageByLegacy.get(String(message._id))
          const replyToId = targetMessageByLegacy.get(String(message.replyToId))
          if (!targetId || !replyToId) throw new Error(`Message reply mapping missing for ${String(message._id)}; rolling back.`)
          await client.query('UPDATE project_messages SET reply_to_id=$1 WHERE id=$2', [replyToId, targetId])
        }

        const targetEntityId = (entityType, sourceId) => {
          const type = String(entityType || '').toUpperCase()
          if (type === 'TASK') return targetTaskByLegacy.get(String(sourceId)) || null
          if (type === 'PROJECT') return targetProjectIds.get(String(sourceId)) || null
          return null
        }
        for (const activity of activityLogs) {
          const sourceId = String(activity._id)
          const existing = await client.query('SELECT id FROM activity_logs WHERE legacy_mongo_id=$1', [sourceId])
          if (existing.rowCount) continue
          const userId = targetUserByLegacy.get(String(activity.userId))
          const entityId = targetEntityId(activity.entityType, activity.entityId)
          if (!userId || !entityId) throw new Error(`Activity log mapping missing for ${sourceId}; rolling back.`)
          await client.query(
            `INSERT INTO activity_logs
             (user_id,action,entity_type,entity_id,metadata,legacy_mongo_id,created_at,updated_at)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
            [userId, String(activity.action), String(activity.entityType).toUpperCase(), entityId,
              JSON.stringify(activity.metadata || {}), sourceId, activity.createdAt || new Date(), activity.updatedAt || new Date()],
          )
        }
        for (const notification of notifications) {
          const sourceId = String(notification._id)
          const existing = await client.query('SELECT id FROM notifications WHERE legacy_mongo_id=$1', [sourceId])
          if (existing.rowCount) continue
          const userId = targetUserByLegacy.get(String(notification.userId))
          const entityId = notification.entityId
            ? (targetTaskByLegacy.get(String(notification.entityId)) || targetProjectIds.get(String(notification.entityId)) || null)
            : null
          if (!userId || (notification.entityId && !entityId)) {
            throw new Error(`Notification mapping missing for ${sourceId}; rolling back.`)
          }
          await client.query(
            `INSERT INTO notifications
             (user_id,type,message,entity_id,read_at,legacy_mongo_id,created_at,updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [userId, String(notification.type), String(notification.message).slice(0, 500), entityId,
              notification.readAt || null, sourceId, notification.createdAt || new Date(), notification.updatedAt || new Date()],
          )
        }

        await client.query('COMMIT')
        report.writesPerformed = true
        report.inserted = { projects: plan.projects.length, tasks: plan.tasks.length, comments: plan.comments.length }
        report.sourceRecordsScanned = report.sourceCounts
        report.note += ' The inserted field counts only newly inserted projects, tasks, and comments; related-domain inserts are reconciled through legacy-ID coverage and post-import preflight rather than inferred from source counts.'
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      }
      process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    } finally {
      client.release()
    }
  } finally {
    await pool.end()
    await mongoose.disconnect()
  }
}

main().catch(async error => {
  console.error('PostgreSQL entity migration failed:', error.message)
  await pool.end().catch(() => {})
  await mongoose.disconnect().catch(() => {})
  process.exitCode = 2
})
