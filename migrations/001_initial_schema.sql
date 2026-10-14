CREATE TABLE app_users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'learner'
    CHECK (role IN ('admin', 'tester', 'learner')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX app_users_email_unique_idx ON app_users (LOWER(email));
CREATE INDEX app_users_role_status_idx ON app_users (role, status);

CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  family_id UUID NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  replaced_by_token_id UUID REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMPTZ
);

CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_id_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_expires_at_idx ON refresh_tokens (expires_at);

CREATE TABLE curated_quizzes (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  grade_level TEXT NOT NULL,
  world_id TEXT,
  topic_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by UUID NOT NULL REFERENCES app_users(id),
  updated_by UUID NOT NULL REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMPTZ
);

CREATE INDEX curated_quizzes_status_idx ON curated_quizzes (status);
CREATE INDEX curated_quizzes_grade_world_idx ON curated_quizzes (grade_level, world_id);

CREATE TABLE quiz_questions (
  id UUID PRIMARY KEY,
  quiz_id UUID NOT NULL REFERENCES curated_quizzes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  prompt TEXT NOT NULL,
  choices JSONB NOT NULL,
  correct_answers JSONB NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  is_multi_select BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (quiz_id, position)
);

CREATE INDEX quiz_questions_quiz_id_idx ON quiz_questions (quiz_id);

CREATE TABLE quiz_attempts (
  id UUID PRIMARY KEY,
  quiz_id UUID REFERENCES curated_quizzes(id) ON DELETE SET NULL,
  learner_profile_id TEXT,
  score INTEGER NOT NULL CHECK (score >= 0),
  total_questions INTEGER NOT NULL CHECK (total_questions > 0),
  response_summary JSONB NOT NULL DEFAULT '{}'::JSONB,
  is_test_account BOOLEAN NOT NULL DEFAULT TRUE,
  exclude_from_analytics BOOLEAN NOT NULL DEFAULT TRUE,
  exclude_from_leaderboard BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (score <= total_questions)
);

CREATE INDEX quiz_attempts_quiz_created_idx ON quiz_attempts (quiz_id, created_at DESC);

CREATE TABLE admin_activity_logs (
  id UUID PRIMARY KEY,
  actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX admin_activity_logs_actor_created_idx
  ON admin_activity_logs (actor_user_id, created_at DESC);

CREATE TABLE asset_metadata (
  id UUID PRIMARY KEY,
  provider TEXT NOT NULL,
  object_key TEXT NOT NULL,
  remote_url TEXT,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('image', 'audio')),
  mime_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'archived')),
  uploaded_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, object_key)
);

CREATE INDEX asset_metadata_status_type_idx ON asset_metadata (status, asset_type);
