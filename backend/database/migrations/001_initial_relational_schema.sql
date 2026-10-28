-- Kendram PostgreSQL foundation: core relational entities.
-- Applied by backend/src/scripts/migratePostgres.js in a transaction.
-- This schema is additive groundwork; the runtime API still uses MongoDB until
-- its data-access layer is migrated and validated in a later change.

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(80) NOT NULL CHECK (length(trim(name)) > 0),
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  role VARCHAR(32) NOT NULL DEFAULT 'TEAM_MEMBER'
    CHECK (role IN ('ADMINISTRATOR', 'PROJECT_MANAGER', 'TEAM_MEMBER')),
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL CHECK (length(trim(name)) > 0),
  description VARCHAR(1000) NOT NULL DEFAULT '',
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status VARCHAR(16) NOT NULL DEFAULT 'PLANNING'
    CHECK (status IN ('PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED')),
  start_date DATE,
  due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (due_date IS NULL OR start_date IS NULL OR due_date >= start_date)
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_role VARCHAR(24) NOT NULL DEFAULT 'MEMBER'
    CHECK (project_role IN ('PROJECT_MANAGER', 'MEMBER', 'VIEWER')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL CHECK (length(trim(name)) > 0),
  description VARCHAR(1000) NOT NULL DEFAULT '',
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS board_columns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL CHECK (length(trim(name)) > 0),
  position INTEGER NOT NULL CHECK (position >= 0),
  wip_limit INTEGER CHECK (wip_limit IS NULL OR wip_limit > 0),
  is_done BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (board_id, name),
  UNIQUE (board_id, position)
);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  column_id UUID NOT NULL REFERENCES board_columns(id) ON DELETE RESTRICT,
  title VARCHAR(180) NOT NULL CHECK (length(trim(title)) > 0),
  description VARCHAR(2000) NOT NULL DEFAULT '',
  priority VARCHAR(16) NOT NULL DEFAULT 'MEDIUM'
    CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  due_date TIMESTAMPTZ,
  position NUMERIC(12,4) NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name VARCHAR(32) NOT NULL CHECK (length(trim(name)) > 0),
  color VARCHAR(7) NOT NULL DEFAULT '#64748b'
    CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  UNIQUE (board_id, name)
);

CREATE TABLE IF NOT EXISTS task_labels (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body VARCHAR(2000) NOT NULL CHECK (length(trim(body)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action VARCHAR(64) NOT NULL,
  before_state JSONB,
  after_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_owner_status ON projects(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id, project_id);
CREATE INDEX IF NOT EXISTS idx_boards_project ON boards(project_id);
CREATE INDEX IF NOT EXISTS idx_columns_board_position ON board_columns(board_id, position);
CREATE INDEX IF NOT EXISTS idx_tasks_board_column_position ON tasks(board_id, column_id, position);
CREATE INDEX IF NOT EXISTS idx_tasks_board_assignee_status ON tasks(board_id, assignee_id, column_id);
CREATE INDEX IF NOT EXISTS idx_tasks_board_due_date ON tasks(board_id, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_board_priority ON tasks(board_id, priority);
CREATE INDEX IF NOT EXISTS idx_comments_task_created ON comments(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_project_created ON activity_history(project_id, created_at DESC);
