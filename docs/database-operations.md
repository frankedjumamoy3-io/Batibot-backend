# BatiBot Backend Database Operations

## Scope

The Phase 2 schema is intentionally limited to controlled administration and shared quiz data. Learner profiles, learner settings, rewards, curriculum, and ordinary progress remain local in the Android APK unless cross-device synchronization is separately approved.

## Tables

```text
schema_migrations
app_users
refresh_tokens
curated_quizzes
quiz_questions
quiz_attempts
admin_activity_logs
asset_metadata
```

Identifiers use UUIDs. Relationships use foreign keys. Authentication roles and publication states are protected by database constraints. Images and audio must not be stored in PostgreSQL; `asset_metadata` stores provider keys and URLs only.

## Environment

Copy `.env.example` to an ignored local `.env` file and supply:

```text
DATABASE_URL
DATABASE_SSL
JWT_ACCESS_SECRET
JWT_REFRESH_SECRET
ADMIN_BOOTSTRAP_EMAIL
ADMIN_BOOTSTRAP_PASSWORD_HASH
ADMIN_BOOTSTRAP_DISPLAY_NAME
```

Rules:

- Use a PostgreSQL connection string belonging only to this service.
- Use separate random access-token and refresh-token secrets of at least 32 characters.
- Store only an Argon2 password hash in `ADMIN_BOOTSTRAP_PASSWORD_HASH`.
- Never put plaintext passwords, URLs containing database credentials, or token secrets in Git, issue trackers, APK variables, or chat messages.

## Apply Migrations

Build the backend, then run:

```bash
npm run build
npm run db:migrate
```

Migration files are immutable after they have been applied. The runner records a SHA-256 checksum and stops if an applied file changes. Create a new numbered migration for every schema change.

The free Render web-service plan does not support a separate pre-deploy command. The Blueprint start command therefore runs the idempotent migration runner before starting the HTTP server. If the migration fails, the server does not start.

## Bootstrap the Controlled Administrator

After migrations and environment configuration:

```bash
npm run admin:bootstrap
```

The command creates or updates the one controlled administrator by normalized email. It never accepts public registration and logs only the resulting user ID.

Remove the bootstrap email and password-hash environment values from the service after the administrator is created if no repeat bootstrap is required. The runtime authentication flow does not need them.

## Backup and Restore Gate

Free Render PostgreSQL has no managed backups and expires after its controlled test window. Use PostgreSQL's official `pg_dump` and `pg_restore` tools through a secure credential flow supplied by the database provider.

Required backup characteristics:

```text
custom archive format
no owner metadata
no ACL metadata
encrypted storage destination
timestamp and migration version recorded separately
```

Representative commands are:

```bash
pg_dump --format=custom --no-owner --no-acl --file batibot-backend.dump
pg_restore --clean --if-exists --no-owner --no-acl --dbname <empty-restore-database> batibot-backend.dump
```

Supply connection settings using the provider's secure environment or password-file mechanism rather than adding a credential-bearing URL to shell history.

Verify the restored database by:

1. running `npm run db:migrate` and confirming no migration is newly applied;
2. checking the expected tables and constraints;
3. signing in with the controlled administrator;
4. rotating and revoking a refresh token; and
5. comparing sanitized record counts with the source database.

## Current Validation Status

- Clean-schema migration: passed with the PostgreSQL-compatible in-memory test adapter.
- Migration checksum/idempotence: passed.
- Authentication and authorization integration tests: passed.
- Dependency audit: no known npm vulnerabilities at implementation time.
- Real PostgreSQL migration: pending a local or Render PostgreSQL instance.
- `pg_dump` / `pg_restore` drill: pending installation or availability of PostgreSQL client tools.

The compatibility adapter is a development check, not a substitute for the real PostgreSQL and backup/restore gate.
