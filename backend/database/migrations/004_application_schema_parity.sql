-- Runtime schema parity for the existing MongoDB models.
-- This is additive: it does not switch any application routes or touch MongoDB.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verification_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_reset_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS display_name VARCHAR(50) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(2048) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bio VARCHAR(240) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS location VARCHAR(80) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT
    '{"notifications":{"taskAssignment":true,"projectInvitation":true,"chatMention":true,"dependencyUnblocked":true,"teamUpdates":true},"display":{"compactMode":false}}'::jsonb;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS estimate_minutes INTEGER
    CHECK (estimate_minutes IS NULL OR estimate_minutes BETWEEN 5 AND 43200),
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  invited_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_role VARCHAR(24) NOT NULL DEFAULT 'MEMBER'
    CHECK (project_role IN ('PROJECT_MANAGER', 'MEMBER', 'VIEWER')),
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED')),
  expires_at TIMESTAMPTZ NOT NULL,
  invited_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invitations_project_user_status
  ON invitations(project_id, invited_user_id, status);
CREATE INDEX IF NOT EXISTS idx_invitations_user_status_expiry
  ON invitations(invited_user_id, status, expires_at);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(80) NOT NULL CHECK (length(trim(type)) > 0),
  message VARCHAR(500) NOT NULL CHECK (length(trim(message)) > 0),
  entity_id UUID,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS project_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  message VARCHAR(2000) NOT NULL CHECK (length(trim(message)) > 0),
  reply_to_id UUID REFERENCES project_messages(id) ON DELETE SET NULL,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  mentions JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(mentions) = 'array'),
  reactions JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(reactions) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_messages_project_created
  ON project_messages(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_messages_task
  ON project_messages(task_id) WHERE task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action VARCHAR(120) NOT NULL CHECK (length(trim(action)) > 0),
  entity_type VARCHAR(80) NOT NULL CHECK (length(trim(entity_type)) > 0),
  entity_id UUID NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_created
  ON activity_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity
  ON activity_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action_created
  ON activity_logs(action, created_at DESC);
