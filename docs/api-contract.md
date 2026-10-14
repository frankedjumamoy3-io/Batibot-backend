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

## Phase 1 Endpoints

### `GET /health`

Returns HTTP 200 while the process is healthy. Phase 2 will extend this check with database readiness without returning database identifiers or connection details.

### `GET /api/v1/status`

Returns the service name, API version, and readiness status for the APK integration layer.
