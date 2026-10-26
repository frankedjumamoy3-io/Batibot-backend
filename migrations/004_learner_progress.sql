ALTER TABLE app_users ADD COLUMN grade_level TEXT;
ALTER TABLE app_users ADD CONSTRAINT app_users_grade_level_check
  CHECK (grade_level IS NULL OR grade_level IN ('Preschool', 'Kindergarten', 'Grade 1', 'Grade 2', 'Grade 3'));

CREATE TABLE learner_progress (
  user_id UUID PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  progress JSONB NOT NULL DEFAULT '{}'::JSONB,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
