-- Migration bridge for records imported from the current MongoDB runtime.
-- SQL UUIDs remain the primary keys; legacy IDs are lookup keys only.
ALTER TABLE users ADD COLUMN IF NOT EXISTS legacy_mongo_id VARCHAR(24);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS legacy_mongo_id VARCHAR(24);
ALTER TABLE boards ADD COLUMN IF NOT EXISTS legacy_mongo_id VARCHAR(24);
ALTER TABLE board_columns ADD COLUMN IF NOT EXISTS legacy_mongo_id VARCHAR(24);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS legacy_mongo_id VARCHAR(24);
ALTER TABLE labels ADD COLUMN IF NOT EXISTS legacy_mongo_id VARCHAR(24);
ALTER TABLE comments ADD COLUMN IF NOT EXISTS legacy_mongo_id VARCHAR(24);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_legacy_mongo_id
  ON users(legacy_mongo_id) WHERE legacy_mongo_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_legacy_mongo_id
  ON projects(legacy_mongo_id) WHERE legacy_mongo_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_boards_legacy_mongo_id
  ON boards(legacy_mongo_id) WHERE legacy_mongo_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_board_columns_legacy_mongo_id
  ON board_columns(legacy_mongo_id) WHERE legacy_mongo_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_legacy_mongo_id
  ON tasks(legacy_mongo_id) WHERE legacy_mongo_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_labels_legacy_mongo_id
  ON labels(legacy_mongo_id) WHERE legacy_mongo_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_legacy_mongo_id
  ON comments(legacy_mongo_id) WHERE legacy_mongo_id IS NOT NULL;

-- Ensure a task's column belongs to the same board as the task itself.
ALTER TABLE board_columns
  ADD CONSTRAINT uq_board_columns_id_board UNIQUE (id, board_id);

ALTER TABLE tasks
  ADD CONSTRAINT fk_tasks_column_same_board
  FOREIGN KEY (column_id, board_id)
  REFERENCES board_columns (id, board_id)
  ON DELETE RESTRICT;
