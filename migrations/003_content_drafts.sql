CREATE TABLE content_drafts (
  id UUID PRIMARY KEY,
  content JSONB NOT NULL,
  grade_level TEXT NOT NULL,
  world_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID NOT NULL REFERENCES app_users(id),
  updated_by UUID NOT NULL REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMPTZ
);
CREATE INDEX content_drafts_updated_idx ON content_drafts (updated_at DESC);
