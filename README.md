# BatiBot API

Private Node.js/Express API for controlled BatiBot Android APK testing.

## Phase 1 Scope

- Express application foundation
- versioned health/status contract
- structured request logging
- stable error responses
- request IDs, security headers, JSON limits, and rate limiting
- Render Blueprint configuration
- no PostgreSQL queries, authentication, asset uploads, AI generation, or mobile integration yet

## Requirements

- Node.js 22
- npm

## Local Setup

```bash
npm ci
copy .env.example .env
npm run dev
```

Do not put real secrets in `.env.example` or commit a local `.env` file.

## Validation

```bash
npm run check
```

## Current Endpoints

```text
GET /health
GET /api/v1/status
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

`render.yaml` defines a single Render web service. PostgreSQL provisioning and authentication begin in Phase 2. External Render deployment must wait until the owner connects the private Git repository to an authenticated Render workspace.
