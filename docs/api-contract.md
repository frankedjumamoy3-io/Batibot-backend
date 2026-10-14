# BatiBot API Contract

## Versioning

Application endpoints use the `/api/v1` prefix. Operational health remains at `/health` so Render can probe it without depending on an application version.

## Request IDs

Every response includes `X-Request-Id`. A valid incoming `X-Request-Id` may be reused; otherwise the API creates an opaque UUID. Clients may report this value for troubleshooting but must not show it to young learners.

## Success Envelope

```json
{
  "data": {},
  "meta": {
    "requestId": "opaque-request-id"
  }
}
```

## Error Envelope

```json
{
  "error": {
    "code": "STABLE_ERROR_CODE",
    "message": "Safe client-facing message",
    "requestId": "opaque-request-id"
  }
}
```

Stack traces, database errors, tokens, secrets, and account-existence details are never part of an API response.

## Foundation Endpoints

### `GET /health`

Returns HTTP 200 while the process and database connection are healthy. Database failures return a safe HTTP 503 response without database identifiers or connection details.

### `GET /api/v1/status`

Returns the service name, API version, and readiness status for the APK integration layer.

## Phase 2 Authentication Endpoints

### `POST /api/v1/auth/login`

Accepts an email address and password for a pre-provisioned controlled account. Successful responses contain a short-lived bearer access token, a rotating refresh token, expiration metadata, and a public user object. Invalid credentials always return the same message.

### `POST /api/v1/auth/refresh`

Accepts a refresh token and rotates it. Reuse of an already rotated token revokes its token family.

### `POST /api/v1/auth/logout`

Revokes the supplied refresh token. Logout is idempotent and does not reveal whether the token existed.

### `GET /api/v1/auth/me`

Requires an `Authorization: Bearer <access-token>` header and returns the active public account. Password hashes and token hashes are never returned.

### `GET /api/v1/admin/status`

Requires an authenticated `admin` role. It is the initial role-enforcement probe for later admin quiz routes.

## Stable Authentication Errors

```text
AUTH_REQUIRED
AUTH_INVALID_CREDENTIALS
AUTH_INVALID_TOKEN
AUTH_RATE_LIMITED
FORBIDDEN
```

Authentication requests are rate limited. Raw authorization headers, cookies, passwords, token hashes, and stack traces must never appear in responses or logs.
