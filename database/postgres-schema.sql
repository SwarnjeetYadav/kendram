-- PostgreSQL reference schema for the YuvaIntern Team Task Board brief.
-- This is a relational design deliverable. The current deployed Kendram API still uses MongoDB.
-- Demo seed password_hash values are intentionally non-authenticatable placeholders; never use these in production.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(24) NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('ADMIN', 'MANAGER', 'MEMBER', 'VIEWER')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_role VARCHAR(24) NOT NULL DEFAULT 'MEMBER' CHECK (team_role IN ('MANAGER', 'MEMBER', 'VIEWER')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE board_columns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  wip_limit INTEGER CHECK (wip_limit IS NULL OR wip_limit > 0),
  UNIQUE (board_id, name),
  UNIQUE (board_id, position)
);

CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  column_id UUID NOT NULL REFERENCES board_columns(id),
  title VARCHAR(180) NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT NOT NULL DEFAULT '',
  priority VARCHAR(16) NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  due_date TIMESTAMPTZ,
  position NUMERIC(12,4) NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name VARCHAR(32) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#64748b',
  UNIQUE (board_id, name)
);

CREATE TABLE task_labels (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);

CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id),
  body VARCHAR(2000) NOT NULL CHECK (length(trim(body)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE activity_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  actor_id UUID NOT NULL REFERENCES users(id),
  action VARCHAR(64) NOT NULL,
  before_state JSONB,
  after_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_board_column_position ON tasks(board_id, column_id, position);
CREATE INDEX idx_tasks_board_assignee ON tasks(board_id, assignee_id);
CREATE INDEX idx_tasks_board_due_date ON tasks(board_id, due_date);
CREATE INDEX idx_tasks_board_priority ON tasks(board_id, priority);
CREATE INDEX idx_comments_task_created ON comments(task_id, created_at);
CREATE INDEX idx_activity_board_created ON activity_history(board_id, created_at DESC);

-- Sample team: 15 fictional teammates.
INSERT INTO users (full_name, email, password_hash, role)
SELECT
  CASE n
    WHEN 1 THEN 'Aarav Mehta' WHEN 2 THEN 'Ananya Kulkarni' WHEN 3 THEN 'Rohan Shah'
    WHEN 4 THEN 'Isha Patil' WHEN 5 THEN 'Kabir Joshi' WHEN 6 THEN 'Meera Deshmukh'
    WHEN 7 THEN 'Arjun Nair' WHEN 8 THEN 'Sana Khan' WHEN 9 THEN 'Vivaan Rao'
    WHEN 10 THEN 'Diya Iyer' WHEN 11 THEN 'Aditya Verma' WHEN 12 THEN 'Kavya Menon'
    WHEN 13 THEN 'Reyansh Gupta' WHEN 14 THEN 'Tara Sinha' ELSE 'Neil Fernandes'
  END,
  'teammate' || n || '@pune.example',
  'SEED_ONLY_REPLACE_WITH_A_REAL_BCRYPT_HASH',
  CASE WHEN n = 1 THEN 'MANAGER' ELSE 'MEMBER' END
FROM generate_series(1, 15) AS n;

INSERT INTO teams (name, description, created_by)
SELECT 'Pune Product Team', 'Fictional 15-person product team for Kanban acceptance testing', id
FROM users WHERE email = 'teammate1@pune.example';

INSERT INTO team_members (team_id, user_id, team_role)
SELECT t.id, u.id, CASE WHEN u.email = 'teammate1@pune.example' THEN 'MANAGER' ELSE 'MEMBER' END
FROM teams t CROSS JOIN users u
WHERE t.name = 'Pune Product Team';

INSERT INTO boards (team_id, name, description, created_by)
SELECT t.id, 'Product Delivery Board', 'Seeded board with active, overdue and unassigned work', u.id
FROM teams t JOIN users u ON u.email = 'teammate1@pune.example';

INSERT INTO board_columns (board_id, name, position, wip_limit)
SELECT b.id, c.name, c.position, c.wip_limit
FROM boards b
CROSS JOIN (VALUES ('Backlog',0,NULL::INTEGER),('To Do',1,8),('In Progress',2,5),('Review',3,4),('Done',4,NULL::INTEGER)) AS c(name,position,wip_limit)
WHERE b.name = 'Product Delivery Board';

INSERT INTO labels (board_id, name, color)
SELECT b.id, l.name, l.color
FROM boards b
CROSS JOIN (VALUES ('backend','#2563eb'),('frontend','#7c3aed'),('bug','#dc2626'),('urgent','#ea580c'),('research','#0f766e')) AS l(name,color)
WHERE b.name = 'Product Delivery Board';

-- Includes overdue tasks and tasks without an assignee, as required by the brief.
INSERT INTO tasks (board_id, column_id, title, description, priority, assignee_id, created_by, due_date, position)
SELECT b.id, c.id, seed.title, seed.description, seed.priority, assignee.id, creator.id, seed.due_date, seed.position
FROM boards b
JOIN users creator ON creator.email = 'teammate1@pune.example'
CROSS JOIN (VALUES
  ('Finalize API contract','Document endpoints and error payloads','HIGH',1,'2026-10-15 17:00:00+05:30'::timestamptz,1),
  ('Fix mobile navigation','Verify layout at narrow widths','MEDIUM',2,'2026-11-02 17:00:00+05:30'::timestamptz,2),
  ('Review onboarding copy','Product copy review','LOW',NULL,'2026-11-06 17:00:00+05:30'::timestamptz,3),
  ('Investigate slow task listing','Profile query plans and indexes','CRITICAL',3,'2026-10-20 17:00:00+05:30'::timestamptz,4),
  ('Prepare release checklist','Include rollback and smoke tests','MEDIUM',NULL,NULL,5),
  ('Add task label filters','Support label and due-date query filters','HIGH',4,'2026-10-22 17:00:00+05:30'::timestamptz,6),
  ('Validate role permissions','Cover viewer and non-member denial paths','HIGH',5,'2026-11-05 17:00:00+05:30'::timestamptz,7)
) AS seed(title,description,priority,assignee_no,due_date,position)
JOIN board_columns c ON c.board_id = b.id AND c.name = CASE WHEN seed.position = 5 THEN 'Done' WHEN seed.position = 4 THEN 'In Progress' WHEN seed.position = 3 THEN 'Review' WHEN seed.position = 2 THEN 'To Do' ELSE 'Backlog' END
LEFT JOIN users assignee ON assignee.email = CASE WHEN seed.assignee_no IS NULL THEN NULL ELSE 'teammate' || seed.assignee_no || '@pune.example' END
WHERE b.name = 'Product Delivery Board';

INSERT INTO task_labels (task_id, label_id)
SELECT t.id, l.id
FROM tasks t
JOIN boards b ON b.id = t.board_id AND b.name = 'Product Delivery Board'
JOIN labels l ON l.board_id = b.id AND (
  (t.title ILIKE '%API%' AND l.name = 'backend') OR
  (t.title ILIKE '%navigation%' AND l.name = 'frontend') OR
  (t.title ILIKE '%slow%' AND l.name = 'bug') OR
  (t.title ILIKE '%filters%' AND l.name = 'backend') OR
  (t.title ILIKE '%release%' AND l.name = 'urgent')
);

INSERT INTO activity_history (board_id, task_id, actor_id, action, after_state)
SELECT t.board_id, t.id, creator.id, 'TASK_SEEDED',
       jsonb_build_object('title', t.title, 'assigneeId', t.assignee_id, 'dueDate', t.due_date)
FROM tasks t
JOIN users creator ON creator.email = 'teammate1@pune.example';
