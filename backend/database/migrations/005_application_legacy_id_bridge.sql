-- Add source-ID bridge columns to application tables introduced after the
-- initial legacy-ID bridge. This is additive and does not import or mutate data.
ALTER TABLE project_members
  ADD COLUMN IF NOT EXISTS legacy_mongo_id VARCHAR(24);
ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS legacy_mongo_id VARCHAR(24);
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS legacy_mongo_id VARCHAR(24);
ALTER TABLE project_messages
  ADD COLUMN IF NOT EXISTS legacy_mongo_id VARCHAR(24);
ALTER TABLE activity_logs
  ADD COLUMN IF NOT EXISTS legacy_mongo_id VARCHAR(24);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_members_legacy_mongo_id
  ON project_members(legacy_mongo_id) WHERE legacy_mongo_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_legacy_mongo_id
  ON invitations(legacy_mongo_id) WHERE legacy_mongo_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_legacy_mongo_id
  ON notifications(legacy_mongo_id) WHERE legacy_mongo_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_messages_legacy_mongo_id
  ON project_messages(legacy_mongo_id) WHERE legacy_mongo_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_logs_legacy_mongo_id
  ON activity_logs(legacy_mongo_id) WHERE legacy_mongo_id IS NOT NULL;
