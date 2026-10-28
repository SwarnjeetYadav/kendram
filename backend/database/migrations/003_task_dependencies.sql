-- Preserve task dependency edges so PostgreSQL task-list responses can expose
-- the same dependency metadata as the MongoDB API.
CREATE TABLE IF NOT EXISTS task_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_mongo_id VARCHAR(24),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  predecessor_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  successor_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (predecessor_task_id <> successor_task_id),
  UNIQUE (project_id, predecessor_task_id, successor_task_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_dependencies_legacy_mongo_id
  ON task_dependencies(legacy_mongo_id) WHERE legacy_mongo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_dependencies_predecessor
  ON task_dependencies(project_id, predecessor_task_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_successor
  ON task_dependencies(project_id, successor_task_id);
