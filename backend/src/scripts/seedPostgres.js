import 'dotenv/config'
import { getPostgresPool, closePostgresPool } from '../db/postgres.js'

async function upsertUser(client, { name, email, role }) {
  const result = await client.query(
    `INSERT INTO users (name,email,password_hash,email_verified,role,status)
     VALUES ($1,$2,$3,TRUE,$4,'ACTIVE')
     ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role, status='ACTIVE', updated_at=now()
     RETURNING id`,
    [name, email, 'SEED_ONLY_AUTH_NOT_MIGRATED', role],
  )
  return result.rows[0].id
}

async function seed() {
  const pool = getPostgresPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const managerId = await upsertUser(client, {
      name: 'Kendram Demo Manager', email: 'demo-manager@kendram.local', role: 'PROJECT_MANAGER',
    })
    const memberId = await upsertUser(client, {
      name: 'Kendram Demo Member', email: 'demo-member@kendram.local', role: 'TEAM_MEMBER',
    })
    const viewerId = await upsertUser(client, {
      name: 'Kendram Demo Viewer', email: 'demo-viewer@kendram.local', role: 'TEAM_MEMBER',
    })

    const existingProject = await client.query(
      'SELECT id FROM projects WHERE owner_id=$1 AND name=$2 ORDER BY created_at LIMIT 1',
      [managerId, 'Kendram PostgreSQL Demo'],
    )
    let projectId = existingProject.rows[0]?.id
    if (!projectId) {
      const projectResult = await client.query(
        `INSERT INTO projects (name,description,owner_id,status)
         VALUES ($1,$2,$3,'ACTIVE') RETURNING id`,
        ['Kendram PostgreSQL Demo', 'Synthetic demo project for PostgreSQL persistence testing', managerId],
      )
      projectId = projectResult.rows[0].id
    }

    await client.query(
      `INSERT INTO project_members (project_id,user_id,project_role)
       VALUES ($1,$2,'PROJECT_MANAGER'),($1,$3,'MEMBER'),($1,$4,'VIEWER')
       ON CONFLICT (project_id,user_id) DO UPDATE SET project_role=EXCLUDED.project_role`,
      [projectId, managerId, memberId, viewerId],
    )

    const boardResult = await client.query(
      `INSERT INTO boards (project_id,name,description,created_by)
       VALUES ($1,'Main Board','Default board for the synthetic demo project',$2)
       ON CONFLICT (project_id,name) DO UPDATE SET description=EXCLUDED.description
       RETURNING id`,
      [projectId, managerId],
    )
    const boardId = boardResult.rows[0].id
    const columnIds = {}
    for (const [position, name, isDone] of [
      [0, 'To Do', false],
      [1, 'In Progress', false],
      [2, 'Review', false],
      [3, 'Done', true],
    ]) {
      const result = await client.query(
        `INSERT INTO board_columns (board_id,name,position,is_done)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (board_id,name) DO UPDATE SET position=EXCLUDED.position,is_done=EXCLUDED.is_done
         RETURNING id`,
        [boardId, name, position, isDone],
      )
      columnIds[name] = result.rows[0].id
    }

    const tasks = [
      { title: 'Review project requirements', description: 'Confirm scope and acceptance criteria.', column: 'To Do', priority: 'HIGH', assignee: memberId, position: 1 },
      { title: 'Build project dashboard', description: 'Implement the first dashboard layout.', column: 'In Progress', priority: 'MEDIUM', assignee: memberId, position: 2 },
      { title: 'Validate PostgreSQL relationships', description: 'Check project, membership, board, and task foreign keys.', column: 'Review', priority: 'HIGH', assignee: managerId, position: 3 },
      { title: 'Create initial relational schema', description: 'Base schema is ready for the demo.', column: 'Done', priority: 'MEDIUM', assignee: managerId, position: 4 },
    ]
    for (const task of tasks) {
      const existing = await client.query(
        'SELECT id FROM tasks WHERE board_id=$1 AND title=$2',
        [boardId, task.title],
      )
      if (existing.rowCount) {
        await client.query(
          `UPDATE tasks SET description=$1,column_id=$2,priority=$3,assignee_id=$4,position=$5,updated_at=now()
           WHERE id=$6`,
          [task.description, columnIds[task.column], task.priority, task.assignee, task.position, existing.rows[0].id],
        )
      } else {
        await client.query(
          `INSERT INTO tasks (board_id,column_id,title,description,priority,assignee_id,created_by,position)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [boardId, columnIds[task.column], task.title, task.description, task.priority, task.assignee, managerId, task.position],
        )
      }
    }

    await client.query('COMMIT')
    console.log('PostgreSQL synthetic demo seed complete: 3 users, 1 project, 3 memberships, 1 board, 4 columns, and 4 tasks.')
    console.log('Authentication is still MongoDB-backed; these SQL-only demo users cannot log in to the application yet.')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await closePostgresPool()
  }
}

seed().catch((error) => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
