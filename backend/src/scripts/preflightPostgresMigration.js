import 'dotenv/config'
import mongoose from 'mongoose'
import { writeFile } from 'node:fs/promises'
import pg from 'pg'
import User from '../models/User.js'
import Project from '../models/Project.js'
import Task from '../models/Task.js'
import TaskDependency from '../models/TaskDependency.js'
import Comment from '../models/Comment.js'
import ProjectMember from '../models/ProjectMember.js'
import Invitation from '../models/Invitation.js'
import ProjectMessage from '../models/ProjectMessage.js'
import ActivityLog from '../models/ActivityLog.js'
import Notification from '../models/Notification.js'

const { Pool } = pg
const requiredMongoUri = process.env.MONGODB_URI?.trim()
const requiredPostgresUrl = process.env.DATABASE_URL?.trim()
const outputPath = process.argv[2]

if (!requiredMongoUri) {
  console.error('Preflight configuration error: MONGODB_URI is required.')
  process.exit(2)
}
if (!requiredPostgresUrl) {
  console.error('Preflight configuration error: DATABASE_URL is required.')
  process.exit(2)
}

// This tool only issues MongoDB reads and PostgreSQL SELECTs. It never imports,
// updates, deletes, creates tables, or enables the PostgreSQL runtime flag.
const pool = new Pool({
  connectionString: requiredPostgresUrl,
  max: 2,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000,
  ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
})

const sourceModels = [
  ['users', User],
  ['projects', Project],
  ['tasks', Task],
  ['taskDependencies', TaskDependency],
  ['comments', Comment],
  ['projectMembers', ProjectMember],
  ['invitations', Invitation],
  ['projectMessages', ProjectMessage],
  ['activityLogs', ActivityLog],
  ['notifications', Notification],
]
const targetTables = [
  'users', 'projects', 'project_members', 'boards', 'board_columns',
  'tasks', 'labels', 'task_labels', 'task_dependencies', 'comments', 'activity_history',
  'invitations', 'notifications', 'project_messages', 'activity_logs',
]
const blockers = []
const warnings = []
const counts = { sourceMongo: {}, targetPostgres: {} }
const checks = []

function addCheck(name, count, severity, detail) {
  const item = { name, count: Number(count), severity, detail }
  checks.push(item)
  if (Number(count) > 0 && severity === 'blocker') blockers.push(item)
  if (Number(count) > 0 && severity === 'warning') warnings.push(item)
}

async function countRows(client, table) {
  // Table names come exclusively from the fixed allow-list above.
  const result = await client.query(`SELECT count(*)::bigint AS count FROM "${table}"`)
  return Number(result.rows[0].count)
}

async function countSql(client, name, sql) {
  const result = await client.query(sql)
  addCheck(name, result.rows[0].count, 'blocker', 'Rows violating a required mapping or integrity rule')
}

async function main() {
  await mongoose.connect(requiredMongoUri, { serverSelectionTimeoutMS: 5000 })
  const client = await pool.connect()
  try {
    const migrationTable = await client.query(
      "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists",
    )
    if (!migrationTable.rows[0].exists) {
      throw new Error('PostgreSQL schema_migrations table is missing. Apply reviewed schema migrations to a designated staging target first.')
    }

    // Load one consistent set of source documents for relationship and ID checks.
    // Use lean() so comparisons operate on plain source records and stringify IDs explicitly.
    const sourceDocs = {
      users: await User.find({}).lean(),
      projects: await Project.find({}).lean(),
      tasks: await Task.find({}).lean(),
      task_dependencies: await TaskDependency.find({}).lean(),
      comments: await Comment.find({}).lean(),
      projectMembers: await ProjectMember.find({}).lean(),
      invitations: await Invitation.find({}).lean(),
      projectMessages: await ProjectMessage.find({}).lean(),
      activityLogs: await ActivityLog.find({}).lean(),
      notifications: await Notification.find({}).lean(),
    }
    const sourceIds = Object.fromEntries(
      Object.entries(sourceDocs).map(([name, documents]) => [
        name,
        new Set(documents.map(document => String(document._id))),
      ]),
    )
    for (const [name, model] of sourceModels) {
      counts.sourceMongo[name] = sourceDocs[name === 'taskDependencies' ? 'task_dependencies' : name].length
    }
    for (const table of targetTables) {
      const exists = await client.query('SELECT to_regclass($1) IS NOT NULL AS exists', [`public.${table}`])
      if (!exists.rows[0].exists) {
        blockers.push({ name: `target_table_missing:${table}`, count: 1, severity: 'blocker', detail: 'Expected table is absent; preflight did not modify schema.' })
        continue
      }
      counts.targetPostgres[table] = await countRows(client, table)
    }

    // Source-to-target coverage is checked for every imported collection.
    const sourceToTargetTables = {
      users: 'users',
      projects: 'projects',
      tasks: 'tasks',
      task_dependencies: 'task_dependencies',
      comments: 'comments',
      projectMembers: 'project_members',
      invitations: 'invitations',
      projectMessages: 'project_messages',
      activityLogs: 'activity_logs',
      notifications: 'notifications',
    }
    for (const [sourceName, table] of Object.entries(sourceToTargetTables)) {
      if (counts.targetPostgres[table] === undefined) continue
      const missingColumn = await client.query(
        "SELECT count(*)::bigint AS count FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='legacy_mongo_id'",
        [table],
      )
      if (Number(missingColumn.rows[0].count) === 0) {
        addCheck(`legacy_id_column_missing:${table}`, 1, 'blocker',
          'The target table has no legacy_mongo_id bridge column; source-to-target reconciliation cannot be proven.')
        continue
      }
      const missing = await client.query(
        `SELECT count(*)::bigint AS count FROM "${table}" WHERE legacy_mongo_id IS NULL`,
      )
      addCheck(`target_rows_without_legacy_id:${table}`, missing.rows[0].count, 'warning',
        'Existing SQL rows without a source Mongo ID cannot be matched by this bridge; review before import or reconciliation.')
      const mapped = await client.query(`SELECT legacy_mongo_id FROM "${table}" WHERE legacy_mongo_id IS NOT NULL`)
      const targetIds = new Set(mapped.rows.map(row => String(row.legacy_mongo_id)))
      const missingSource = [...(sourceIds[sourceName] || [])].filter(id => !targetIds.has(id))
      addCheck(`source_records_without_target_mapping:${table}`, missingSource.length, 'blocker',
        'Source MongoDB records with no matching PostgreSQL legacy_mongo_id.')
      const sourceSet = sourceIds[sourceName] || new Set()
      const stale = [...targetIds].filter(id => !sourceSet.has(id))
      addCheck(`target_legacy_ids_without_source_record:${table}`, stale.length, 'warning',
        'Target rows carry legacy IDs that are absent from the current MongoDB source; review deletions, source snapshots, or stale mappings.')
    }

    // Reconcile foreign-key relationships against the source IDs, not merely
    // whether target foreign keys point to some valid row.
    const targetProjects = await client.query(
      `SELECT p.legacy_mongo_id, owner.legacy_mongo_id AS owner_legacy_mongo_id
       FROM projects p JOIN users owner ON owner.id=p.owner_id
       WHERE p.legacy_mongo_id IS NOT NULL`,
    )
    const targetProjectByLegacy = new Map(targetProjects.rows.map((row) => [String(row.legacy_mongo_id), row]))
    let projectOwnerMismatches = 0
    for (const source of sourceDocs.projects) {
      const target = targetProjectByLegacy.get(String(source._id))
      if (target && String(target.owner_legacy_mongo_id) !== String(source.ownerId)) projectOwnerMismatches += 1
    }
    addCheck('mapped_project_owner_mismatches', projectOwnerMismatches, 'blocker',
      'Mapped projects whose PostgreSQL owner legacy ID differs from the MongoDB owner ID.')

    const targetTasks = await client.query(
      `SELECT t.legacy_mongo_id, p.legacy_mongo_id AS project_legacy_mongo_id,
              creator.legacy_mongo_id AS creator_legacy_mongo_id,
              assignee.legacy_mongo_id AS assignee_legacy_mongo_id
       FROM tasks t JOIN boards b ON b.id=t.board_id
       JOIN projects p ON p.id=b.project_id
       JOIN users creator ON creator.id=t.created_by
       LEFT JOIN users assignee ON assignee.id=t.assignee_id
       WHERE t.legacy_mongo_id IS NOT NULL`,
    )
    const targetTaskByLegacy = new Map(targetTasks.rows.map((row) => [String(row.legacy_mongo_id), row]))
    let taskRelationshipMismatches = 0
    for (const source of sourceDocs.tasks) {
      const target = targetTaskByLegacy.get(String(source._id))
      if (!target) continue
      if (String(target.project_legacy_mongo_id) !== String(source.projectId)
        || String(target.creator_legacy_mongo_id) !== String(source.createdBy)
        || String(target.assignee_legacy_mongo_id || '') !== String(source.assigneeId || '')) {
        taskRelationshipMismatches += 1
      }
    }
    addCheck('mapped_task_relationship_mismatches', taskRelationshipMismatches, 'blocker',
      'Mapped tasks whose project, creator, or assignee legacy IDs differ from MongoDB.')

    const targetComments = await client.query(
      `SELECT c.legacy_mongo_id, t.legacy_mongo_id AS task_legacy_mongo_id,
              author.legacy_mongo_id AS author_legacy_mongo_id
       FROM comments c JOIN tasks t ON t.id=c.task_id
       JOIN users author ON author.id=c.author_id
       WHERE c.legacy_mongo_id IS NOT NULL`,
    )
    const targetCommentByLegacy = new Map(targetComments.rows.map((row) => [String(row.legacy_mongo_id), row]))
    let commentRelationshipMismatches = 0
    for (const source of sourceDocs.comments) {
      const target = targetCommentByLegacy.get(String(source._id))
      if (!target) continue
      if (String(target.task_legacy_mongo_id) !== String(source.taskId)
        || String(target.author_legacy_mongo_id) !== String(source.userId)) {
        commentRelationshipMismatches += 1
      }
    }
    addCheck('mapped_comment_relationship_mismatches', commentRelationshipMismatches, 'blocker',
      'Mapped comments whose task or author legacy IDs differ from MongoDB.')

    const targetMemberships = await client.query(
      `SELECT pm.legacy_mongo_id, p.legacy_mongo_id AS project_legacy_mongo_id,
              u.legacy_mongo_id AS user_legacy_mongo_id, pm.project_role
       FROM project_members pm
       JOIN projects p ON p.id=pm.project_id
       JOIN users u ON u.id=pm.user_id
       WHERE pm.legacy_mongo_id IS NOT NULL`,
    )
    const targetMembershipByLegacy = new Map(targetMemberships.rows.map(row => [String(row.legacy_mongo_id), row]))
    let membershipMismatches = 0
    for (const source of sourceDocs.projectMembers) {
      const target = targetMembershipByLegacy.get(String(source._id))
      if (target && (String(target.project_legacy_mongo_id) !== String(source.projectId)
        || String(target.user_legacy_mongo_id) !== String(source.userId)
        || target.project_role !== (source.projectRole || 'MEMBER'))) membershipMismatches += 1
    }
    addCheck('mapped_membership_relationship_mismatches', membershipMismatches, 'blocker',
      'Mapped memberships whose project, user, or role differs from MongoDB.')

    const targetInvitations = await client.query(
      `SELECT i.legacy_mongo_id, p.legacy_mongo_id AS project_legacy_mongo_id,
              invited.legacy_mongo_id AS invited_user_legacy_mongo_id,
              inviter.legacy_mongo_id AS inviter_legacy_mongo_id
       FROM invitations i JOIN projects p ON p.id=i.project_id
       JOIN users invited ON invited.id=i.invited_user_id
       JOIN users inviter ON inviter.id=i.invited_by
       WHERE i.legacy_mongo_id IS NOT NULL`,
    )
    const targetInvitationByLegacy = new Map(targetInvitations.rows.map(row => [String(row.legacy_mongo_id), row]))
    let invitationMismatches = 0
    for (const source of sourceDocs.invitations) {
      const target = targetInvitationByLegacy.get(String(source._id))
      if (target && (String(target.project_legacy_mongo_id) !== String(source.projectId)
        || String(target.invited_user_legacy_mongo_id) !== String(source.invitedUserId)
        || String(target.inviter_legacy_mongo_id) !== String(source.invitedBy))) invitationMismatches += 1
    }
    addCheck('mapped_invitation_relationship_mismatches', invitationMismatches, 'blocker',
      'Mapped invitations whose project, invitee, or inviter differs from MongoDB.')

    const targetMessages = await client.query(
      `SELECT m.legacy_mongo_id, p.legacy_mongo_id AS project_legacy_mongo_id,
              u.legacy_mongo_id AS sender_legacy_mongo_id,
              t.legacy_mongo_id AS task_legacy_mongo_id,
              reply.legacy_mongo_id AS reply_legacy_mongo_id
       FROM project_messages m JOIN projects p ON p.id=m.project_id
       JOIN users u ON u.id=m.user_id
       LEFT JOIN tasks t ON t.id=m.task_id
       LEFT JOIN project_messages reply ON reply.id=m.reply_to_id
       WHERE m.legacy_mongo_id IS NOT NULL`,
    )
    const targetMessageByLegacy = new Map(targetMessages.rows.map(row => [String(row.legacy_mongo_id), row]))
    let messageMismatches = 0
    for (const source of sourceDocs.projectMessages) {
      const target = targetMessageByLegacy.get(String(source._id))
      if (target && (String(target.project_legacy_mongo_id) !== String(source.projectId)
        || String(target.sender_legacy_mongo_id) !== String(source.userId)
        || String(target.task_legacy_mongo_id || '') !== String(source.taskId || '')
        || String(target.reply_legacy_mongo_id || '') !== String(source.replyToId || ''))) messageMismatches += 1
    }
    addCheck('mapped_project_message_relationship_mismatches', messageMismatches, 'blocker',
      'Mapped project messages whose project, sender, task, or reply reference differs from MongoDB.')

    const targetActivityLogs = await client.query(
      `SELECT a.legacy_mongo_id, a.entity_type, u.legacy_mongo_id AS actor_legacy_mongo_id,
              p.legacy_mongo_id AS project_legacy_mongo_id, t.legacy_mongo_id AS task_legacy_mongo_id
       FROM activity_logs a JOIN users u ON u.id=a.user_id
       LEFT JOIN projects p ON a.entity_type='PROJECT' AND p.id=a.entity_id
       LEFT JOIN tasks t ON a.entity_type='TASK' AND t.id=a.entity_id
       WHERE a.legacy_mongo_id IS NOT NULL`,
    )
    const targetActivityByLegacy = new Map(targetActivityLogs.rows.map(row => [String(row.legacy_mongo_id), row]))
    let activityMismatches = 0
    for (const source of sourceDocs.activityLogs) {
      const target = targetActivityByLegacy.get(String(source._id))
      if (!target) continue
      const sourceEntityId = String(source.entityId)
      const targetEntityId = String(target.entity_type === 'PROJECT'
        ? target.project_legacy_mongo_id || ''
        : target.entity_type === 'TASK' ? target.task_legacy_mongo_id || '' : '')
      if (String(target.actor_legacy_mongo_id) !== String(source.userId)
        || String(target.entity_type) !== String(source.entityType).toUpperCase()
        || targetEntityId !== sourceEntityId) activityMismatches += 1
    }
    addCheck('mapped_activity_log_relationship_mismatches', activityMismatches, 'blocker',
      'Mapped activity entries whose actor or TASK/PROJECT entity differs from MongoDB.')

    const targetNotifications = await client.query(
      `SELECT n.legacy_mongo_id, u.legacy_mongo_id AS recipient_legacy_mongo_id,
              t.legacy_mongo_id AS task_legacy_mongo_id, p.legacy_mongo_id AS project_legacy_mongo_id
       FROM notifications n JOIN users u ON u.id=n.user_id
       LEFT JOIN tasks t ON t.id=n.entity_id
       LEFT JOIN projects p ON p.id=n.entity_id
       WHERE n.legacy_mongo_id IS NOT NULL`,
    )
    const targetNotificationByLegacy = new Map(targetNotifications.rows.map(row => [String(row.legacy_mongo_id), row]))
    let notificationMismatches = 0
    for (const source of sourceDocs.notifications) {
      const target = targetNotificationByLegacy.get(String(source._id))
      if (!target) continue
      const targetEntityId = String(target.task_legacy_mongo_id || target.project_legacy_mongo_id || '')
      if (String(target.recipient_legacy_mongo_id) !== String(source.userId)
        || targetEntityId !== String(source.entityId || '')) notificationMismatches += 1
    }
    addCheck('mapped_notification_relationship_mismatches', notificationMismatches, 'blocker',
      'Mapped notifications whose recipient or referenced task/project differs from MongoDB.')

    const userIds = sourceIds.users
    const projectIds = sourceIds.projects
    const taskIds = sourceIds.tasks
    let missingMembershipReferences = 0
    for (const member of sourceDocs.projectMembers) {
      if (!projectIds.has(String(member.projectId)) || !userIds.has(String(member.userId))) missingMembershipReferences += 1
    }
    addCheck('source_memberships_missing_project_or_user', missingMembershipReferences, 'blocker',
      'MongoDB project membership records with a missing project or user.')

    let missingInvitationReferences = 0
    for (const invitation of sourceDocs.invitations) {
      if (!projectIds.has(String(invitation.projectId)) || !userIds.has(String(invitation.invitedUserId)) || !userIds.has(String(invitation.invitedBy))) missingInvitationReferences += 1
    }
    addCheck('source_invitations_missing_project_or_user', missingInvitationReferences, 'blocker',
      'MongoDB invitations with a missing project, invited user, or inviter.')

    let missingMessageReferences = 0
    let missingMessageReplies = 0
    let missingMessageParticipants = 0
    const messageIds = sourceIds.projectMessages
    for (const message of sourceDocs.projectMessages) {
      if (!projectIds.has(String(message.projectId)) || !userIds.has(String(message.userId))
        || (message.taskId && !taskIds.has(String(message.taskId)))) missingMessageReferences += 1
      if (message.replyToId && !messageIds.has(String(message.replyToId))) missingMessageReplies += 1
      if ((Array.isArray(message.mentions) && message.mentions.some(id => !userIds.has(String(id))))
        || (Array.isArray(message.reactions) && message.reactions.some(reaction => !userIds.has(String(reaction.userId))))) {
        missingMessageParticipants += 1
      }
    }
    addCheck('source_project_messages_missing_references', missingMessageReferences, 'blocker',
      'MongoDB project messages with a missing project, sender, or referenced task.')
    addCheck('source_project_messages_missing_reply', missingMessageReplies, 'blocker',
      'MongoDB project messages with a replyToId that does not resolve to a source message.')
    addCheck('source_project_messages_missing_mention_or_reaction_user', missingMessageParticipants, 'blocker',
      'MongoDB message mentions or reactions referencing a missing source user.')

    let missingActivityReferences = 0
    for (const activity of sourceDocs.activityLogs) {
      const type = String(activity.entityType || '').toUpperCase()
      const entityExists = type === 'TASK'
        ? taskIds.has(String(activity.entityId))
        : type === 'PROJECT'
          ? projectIds.has(String(activity.entityId))
          : false
      if (!userIds.has(String(activity.userId)) || !entityExists || !String(activity.action || '').trim()) {
        missingActivityReferences += 1
      }
    }
    addCheck('source_activity_logs_missing_actor_or_entity', missingActivityReferences, 'blocker',
      'MongoDB activity logs with a missing actor, unsupported entity type, dangling entity ID, or empty action.')

    let missingNotificationReferences = 0
    for (const notification of sourceDocs.notifications) {
      const entityId = notification.entityId ? String(notification.entityId) : null
      if (!userIds.has(String(notification.userId)) || !String(notification.type || '').trim()
        || !String(notification.message || '').trim()
        || (entityId && !taskIds.has(entityId) && !projectIds.has(entityId))) {
        missingNotificationReferences += 1
      }
    }
    addCheck('source_notifications_missing_recipient_or_entity', missingNotificationReferences, 'blocker',
      'MongoDB notifications with a missing recipient, empty type/message, or entity ID outside tasks/projects.')

    for (const project of sourceDocs.projects) {
      if (!userIds.has(String(project.ownerId))) {
        addCheck('source_projects_missing_owner', 1, 'blocker', `Project ${project._id} references a missing MongoDB owner.`)
      }
    }
    for (const task of sourceDocs.tasks) {
      if (!projectIds.has(String(task.projectId))) addCheck('source_tasks_missing_project', 1, 'blocker', `Task ${task._id} references a missing MongoDB project.`)
      if (!userIds.has(String(task.createdBy))) addCheck('source_tasks_missing_creator', 1, 'blocker', `Task ${task._id} references a missing MongoDB creator.`)
      if (task.assigneeId && !userIds.has(String(task.assigneeId))) addCheck('source_tasks_missing_assignee', 1, 'blocker', `Task ${task._id} references a missing MongoDB assignee.`)
      if (!['TODO', 'IN_PROGRESS', 'REVIEW', 'BLOCKED', 'COMPLETED'].includes(task.status)) {
        addCheck('source_tasks_unsupported_status', 1, 'blocker', `Task ${task._id} has unsupported status ${task.status || 'missing'}.`)
      }
      // Embedded labels are normalized by migratePostgresEntities.js; validate
      // their shape there rather than treating supported labels as a blocker here.
    }
    for (const dependency of sourceDocs.task_dependencies) {
      if (!projectIds.has(String(dependency.projectId))) addCheck('source_dependencies_missing_project', 1, 'blocker', `Dependency ${dependency._id} references a missing project.`)
      if (!taskIds.has(String(dependency.predecessorTaskId))) addCheck('source_dependencies_missing_predecessor', 1, 'blocker', `Dependency ${dependency._id} references a missing predecessor task.`)
      if (!taskIds.has(String(dependency.successorTaskId))) addCheck('source_dependencies_missing_successor', 1, 'blocker', `Dependency ${dependency._id} references a missing successor task.`)
      if (!userIds.has(String(dependency.createdBy))) addCheck('source_dependencies_missing_creator', 1, 'blocker', `Dependency ${dependency._id} references a missing creator.`)
      if (String(dependency.predecessorTaskId) === String(dependency.successorTaskId)) addCheck('source_dependencies_self_reference', 1, 'blocker', `Dependency ${dependency._id} points to the same task on both ends.`)
    }
    for (const comment of sourceDocs.comments) {
      if (!taskIds.has(String(comment.taskId))) addCheck('source_comments_missing_task', 1, 'blocker', `Comment ${comment._id} references a missing task.`)
      if (!userIds.has(String(comment.userId))) addCheck('source_comments_missing_author', 1, 'blocker', `Comment ${comment._id} references a missing author.`)
    }

    // Mapping and relational-integrity checks: SELECT only.
    const integrityChecks = [
      ['projects_missing_owner', `SELECT count(*)::bigint AS count FROM projects p LEFT JOIN users u ON u.id=p.owner_id WHERE u.id IS NULL`],
      ['memberships_missing_project_or_user', `SELECT count(*)::bigint AS count FROM project_members pm LEFT JOIN projects p ON p.id=pm.project_id LEFT JOIN users u ON u.id=pm.user_id WHERE p.id IS NULL OR u.id IS NULL`],
      ['boards_missing_project_or_creator', `SELECT count(*)::bigint AS count FROM boards b LEFT JOIN projects p ON p.id=b.project_id LEFT JOIN users u ON u.id=b.created_by WHERE p.id IS NULL OR u.id IS NULL`],
      ['columns_missing_board', `SELECT count(*)::bigint AS count FROM board_columns c LEFT JOIN boards b ON b.id=c.board_id WHERE b.id IS NULL`],
      ['tasks_missing_board_column_creator_or_project_context', `SELECT count(*)::bigint AS count FROM tasks t LEFT JOIN boards b ON b.id=t.board_id LEFT JOIN board_columns c ON c.id=t.column_id AND c.board_id=t.board_id LEFT JOIN users u ON u.id=t.created_by LEFT JOIN users a ON a.id=t.assignee_id WHERE b.id IS NULL OR c.id IS NULL OR u.id IS NULL OR (t.assignee_id IS NOT NULL AND a.id IS NULL)`],
      ['task_dependencies_missing_references_or_cross_project_edges', `SELECT count(*)::bigint AS count FROM task_dependencies d LEFT JOIN projects p ON p.id=d.project_id LEFT JOIN tasks pred ON pred.id=d.predecessor_task_id LEFT JOIN tasks succ ON succ.id=d.successor_task_id LEFT JOIN users u ON u.id=d.created_by LEFT JOIN boards pb ON pb.id=pred.board_id LEFT JOIN boards sb ON sb.id=succ.board_id WHERE p.id IS NULL OR pred.id IS NULL OR succ.id IS NULL OR u.id IS NULL OR pred.id=succ.id OR pb.project_id<>d.project_id OR sb.project_id<>d.project_id`],
      ['comments_missing_task_or_author', `SELECT count(*)::bigint AS count FROM comments c LEFT JOIN tasks t ON t.id=c.task_id LEFT JOIN users u ON u.id=c.author_id WHERE t.id IS NULL OR u.id IS NULL`],
      ['tasks_with_unknown_status_column', `SELECT count(*)::bigint AS count FROM tasks t JOIN board_columns c ON c.id=t.column_id WHERE upper(replace(c.name, ' ', '_')) NOT IN ('TODO','TO_DO','IN_PROGRESS','REVIEW','BLOCKED','COMPLETED','DONE')`],
      ['duplicate_dependency_edges', `SELECT count(*)::bigint AS count FROM (SELECT project_id, predecessor_task_id, successor_task_id FROM task_dependencies GROUP BY project_id, predecessor_task_id, successor_task_id HAVING count(*)>1) x`],
      ['duplicate_legacy_ids_users', `SELECT count(*)::bigint AS count FROM (SELECT legacy_mongo_id FROM users WHERE legacy_mongo_id IS NOT NULL GROUP BY legacy_mongo_id HAVING count(*)>1) x`],
      ['duplicate_legacy_ids_projects', `SELECT count(*)::bigint AS count FROM (SELECT legacy_mongo_id FROM projects WHERE legacy_mongo_id IS NOT NULL GROUP BY legacy_mongo_id HAVING count(*)>1) x`],
      ['duplicate_legacy_ids_tasks', `SELECT count(*)::bigint AS count FROM (SELECT legacy_mongo_id FROM tasks WHERE legacy_mongo_id IS NOT NULL GROUP BY legacy_mongo_id HAVING count(*)>1) x`],
      ['duplicate_legacy_ids_task_dependencies', `SELECT count(*)::bigint AS count FROM (SELECT legacy_mongo_id FROM task_dependencies WHERE legacy_mongo_id IS NOT NULL GROUP BY legacy_mongo_id HAVING count(*)>1) x`],
      ['duplicate_legacy_ids_comments', `SELECT count(*)::bigint AS count FROM (SELECT legacy_mongo_id FROM comments WHERE legacy_mongo_id IS NOT NULL GROUP BY legacy_mongo_id HAVING count(*)>1) x`],
      ['duplicate_project_memberships', `SELECT count(*)::bigint AS count FROM (SELECT project_id,user_id FROM project_members GROUP BY project_id,user_id HAVING count(*)>1) x`],
      ['duplicate_legacy_ids_invitations', `SELECT count(*)::bigint AS count FROM (SELECT legacy_mongo_id FROM invitations WHERE legacy_mongo_id IS NOT NULL GROUP BY legacy_mongo_id HAVING count(*)>1) x`],
      ['duplicate_legacy_ids_notifications', `SELECT count(*)::bigint AS count FROM (SELECT legacy_mongo_id FROM notifications WHERE legacy_mongo_id IS NOT NULL GROUP BY legacy_mongo_id HAVING count(*)>1) x`],
      ['duplicate_legacy_ids_project_messages', `SELECT count(*)::bigint AS count FROM (SELECT legacy_mongo_id FROM project_messages WHERE legacy_mongo_id IS NOT NULL GROUP BY legacy_mongo_id HAVING count(*)>1) x`],
      ['duplicate_legacy_ids_activity_logs', `SELECT count(*)::bigint AS count FROM (SELECT legacy_mongo_id FROM activity_logs WHERE legacy_mongo_id IS NOT NULL GROUP BY legacy_mongo_id HAVING count(*)>1) x`],
    ]
    for (const [name, sql] of integrityChecks) await countSql(client, name, sql)

    const deltas = {}
    for (const [name, sourceCount] of Object.entries(counts.sourceMongo)) {
      const table = ({
        taskDependencies: 'task_dependencies',
        projectMembers: 'project_members',
        projectMessages: 'project_messages',
        activityLogs: 'activity_logs',
      })[name] || name
      if (counts.targetPostgres[table] !== undefined) {
        deltas[name] = { source: sourceCount, target: counts.targetPostgres[table], delta: counts.targetPostgres[table] - sourceCount }
        if (sourceCount !== counts.targetPostgres[table]) {
          addCheck(`count_delta:${name}`, Math.abs(counts.targetPostgres[table] - sourceCount), 'warning',
            'Raw counts differ. This is a review signal, not proof of missing records; compare legacy-ID coverage and exclusions.')
        }
      }
    }

    // Import scope is implemented in the staging importer. Readiness remains
    // a reconciliation result, never cutover authorization: the report is
    // blocked by missing mappings, integrity failures, or warnings above.

    const report = {
      reportType: 'postgres-migration-read-only-preflight',
      generatedAt: new Date().toISOString(),
      mode: 'READ_ONLY',
      source: 'MongoDB',
      target: 'PostgreSQL',
      productionWritesPerformed: false,
      counts,
      countDeltas: deltas,
      checks,
      blockers,
      warnings,
      readyForImport: blockers.length === 0 && warnings.length === 0,
      note: 'A clean preflight only confirms the checks represented here for this snapshot; it is not cutover approval. Source and target data can change during collection, and backup/restore, rollback, API parity, and staging acceptance remain separate gates.',
    }
    const json = JSON.stringify(report, null, 2)
    if (outputPath) {
      await writeFile(outputPath, json + '\n', { encoding: 'utf8', flag: 'wx' })
    }
    process.stdout.write(json + '\n')
    if (blockers.length || warnings.length) process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
    await mongoose.disconnect()
  }
}

main().catch(async (error) => {
  console.error(`Preflight failed: ${error.message}`)
  await pool.end().catch(() => {})
  await mongoose.disconnect().catch(() => {})
  process.exitCode = 2
})
