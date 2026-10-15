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

## Phase 3 quiz endpoints

Public `GET /api/v1/quizzes` and `GET /api/v1/quizzes/:id` return only published content. Admin quiz endpoints require an active administrator role. List endpoints accept `limit` (1-100, default 50), `offset` (0-100000) and, for quizzes, an optional `gradeLevel`. Their data envelope is `{ items, nextOffset }`; a null next offset marks the end.

`POST /api/v1/admin/quizzes` accepts a mobile quiz draft. Required fields are title, topic, objective, instructions, gradeLevel, learnerLevel, worldId, topicId, phase, category, difficulty, curriculumLevel, questionTypes, rewards and questions. Status defaults to draft. Questions use the existing APK shape: id, type, prompt, answer/options for choice questions, sentence/wordBank for fill-in, or pairs for matching. The API supports the existing single-target question formats; multi-select authoring is not part of this release.

`PATCH /api/v1/admin/quizzes/:id` merges fields into the stored draft and validates the entire result. Server-owned IDs, authors, dates and versions are never assigned from request fields. Known presentation fields are retained; unknown presentation metadata is discarded. Updates increment the version. This controlled console assumes one active editor; concurrent valid updates use last-write-wins semantics.

Validation requires a known grade/world/topic assignment, a known learning phase, unique question IDs/prompts, distinct normalized choices, and one correct visible choice. Numeric equivalents such as `one` and `1` cannot be duplicate options. The stored answer is canonicalized to the exact visible choice. Matching columns must be unique; ordering answers must be a permutation of the tiles. Early learner choice questions require two or four choices. Publication additionally requires all ten review checklist entries and mobilePreviewChecked to be true. These human attestations supplement deterministic answer checks.

Quiz content and normalized question rows are saved with their audit entry in one transaction. `ready-for-review` is represented by database status `draft` and retained in content metadata. `DELETE /api/v1/admin/quizzes/:id` rejects published quizzes with HTTP 409; unpublish first. Public responses omit author identifiers, admin notes, prompts used for generation and review checklists. Correct answers remain in the published payload for the APK's existing local scoring.

`GET /api/v1/admin/activity-logs` returns paginated server-generated quiz activity. There is no public audit-write endpoint.

`POST /api/v1/quiz-attempts` accepts exactly `{ quizId, score, totalQuestions }`. The quiz must be published and the question count must match. Extra fields, negative scores and scores above the total are rejected. It accepts anonymous controlled-test reports under the global rate limit; reported scores are not trusted for rewards or rankings. All records are forced to test/excluded status and contain no learner identifiers. Clients must not retry these writes automatically after transport failure.

Migration `002_quiz_content.sql` adds the mobile content fields. Curriculum validation metadata is generated by the frontend's `scripts/export-api-curriculum.cjs`; changes to the bundled curriculum require regenerating and reviewing `src/quizzes/curriculum-catalog.ts`. This catalog contains identifiers only, not a second curriculum database.
