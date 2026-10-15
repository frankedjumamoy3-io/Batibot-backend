# BatiBot Backend

Private Node.js/Express API for controlled BatiBot Android APK testing.

## Current Scope

- Express application foundation
- versioned health/status contract
- structured request logging
- stable error responses
- request IDs, security headers, JSON limits, and rate limiting
- versioned PostgreSQL migrations
- controlled administrator authentication
- Argon2 password verification
- short-lived JWT access tokens
- rotating opaque refresh tokens stored as HMAC hashes
- `admin` / `tester` / `learner` role enforcement
- idempotent administrator bootstrap command
- Render Blueprint configuration
- published quiz reads and protected manual quiz administration
- curriculum/answer integrity validation and transactional audit logs
- sanitized optional test-attempt reporting
- Android APK adapters in the sibling frontend repository
- no asset uploads or AI generation

## Requirements

- Node.js 22
- npm
- PostgreSQL for local or deployed runtime

## Local Setup

```bash
npm ci
copy .env.example .env
npm run build
npm run db:migrate
npm run admin:bootstrap
npm run dev
```

Do not put real secrets in `.env.example` or commit a local `.env` file.

`JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must each contain at least 32 random characters. `ADMIN_BOOTSTRAP_PASSWORD_HASH` must be an Argon2 hash, never a plaintext password.

## Validation

```bash
npm run check
```

## Current Endpoints

```text
GET /health
GET /api/v1/status
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET /api/v1/auth/me
GET /api/v1/admin/status
GET /api/v1/quizzes
GET /api/v1/quizzes/:id
POST /api/v1/quiz-attempts
GET /api/v1/admin/quizzes
GET /api/v1/admin/quizzes/:id
POST /api/v1/admin/quizzes
PATCH /api/v1/admin/quizzes/:id
DELETE /api/v1/admin/quizzes/:id
GET /api/v1/admin/activity-logs
```

Success responses use:

```json
{
  "data": {},
  "meta": {
    "requestId": "opaque-request-id"
  }
}
```

Errors use:

```json
{
  "error": {
    "code": "STABLE_ERROR_CODE",
    "message": "Safe client-facing message",
    "requestId": "opaque-request-id"
  }
}
```

## Deployment

`render.yaml` defines a single free Render web service and runs the idempotent migration command immediately before the server starts. PostgreSQL must be provisioned separately and exposed to the service through `DATABASE_URL`. External deployment must wait until the owner connects this private repository to an authenticated Render workspace.

Database operations, schema ownership, backup commands, and the remaining real-PostgreSQL validation gate are documented in [`docs/database-operations.md`](docs/database-operations.md).
