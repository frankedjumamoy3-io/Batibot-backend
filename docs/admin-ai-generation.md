# Admin AI generation

The active Node API now handles quiz and lesson-stage generation. OpenAI credentials remain on the server. The mobile app sends its existing administrator access token; Firebase tokens are not used on this path.

## Configuration and rollout

1. Set `OPENAI_API_KEY` in the backend hosting service's secret environment settings. Do not put it in Expo configuration, Git, browser storage, or an `EXPO_PUBLIC_` variable.
2. Set `OPENAI_MODEL` to a model available to that key. The default is `gpt-6.1-sol`. `AI_TIMEOUT_MS` defaults to 60000 and permits up to 90000; the app waits up to 100 seconds. Generation does not automatically retry billed requests.
3. For browser-based administration, set `CORS_ALLOWED_ORIGINS` to a comma-separated list of exact website origins, such as `https://admin.example.com`. Native Android requests do not require an origin entry. Do not use `*`.
4. Deploy the backend build and run migrations, including `003_content_drafts.sql`. The existing Render start command runs migrations before starting the service. No existing migration was changed.
5. Build/deploy the frontend with `EXPO_PUBLIC_API_BASE_URL=https://YOUR-BACKEND/api/v1`. Clear Expo's bundler cache when changing this build-time value (`expo export --platform web --clear` for web). An installed APK must be rebuilt to include the new screens.
6. Open Admin Settings: OpenAI configuration comes from `GET /api/v1/admin/ai/status`. This confirms configuration, not provider availability.
7. With the server secret environment available, run `npm run test:ai-live` (or `node dist/scripts/smoke-ai.js` on a production-only installation). It makes one real OpenAI request for two generic family questions, validates the result, and saves/publishes nothing. It may consume provider quota. Output contains only status, model and count.
8. Test admin login → Generate quiz → edit → save → reopen → preview and review checklist → publish → learner quiz. Test Create AI Draft → validate → approve → publish for lesson content.

The local implementation session had no OpenAI key or database deployment credentials. The live check correctly returned `AI_NOT_CONFIGURED`; no real provider success or production deployment is claimed.

## Contracts

All paths below are relative to `/api/v1`.

| Path | Method | Purpose |
| --- | --- | --- |
| `/admin/ai/status` | GET | Key-presence status and selected model; no secret values |
| `/admin/ai/quizzes` | POST | Validated quiz request → `{ quiz }`, always a draft |
| `/admin/ai/content` | POST | Lesson metadata request → `{ draft }`, eight stages |
| `/admin/content-drafts` | GET / POST | Paginated durable drafts / create draft |
| `/admin/content-drafts/:id` | GET / PATCH | Reopen / edit with workflow checks |
| `/admin/content-drafts/:id/publish` | POST | Publish previously approved content atomically |
| `/admin/published-content` | GET | Administrator publication list |
| `/published-content` | GET | Public published content, filterable by grade and world |

Existing quiz CRUD/publication endpoints remain in use. All administrator routes check the server-side role. Generation is limited to six requests per administrator per minute per server process. For multiple replicas, replace the in-memory rate-limit store with shared storage.

## Validation and scope

- Quiz output is checked against the existing curriculum and answer validator: requested count/type, distinct question prompts and options, valid visible answers and matching pairs. Model publication claims and review flags are discarded. Factual accuracy and age suitability require administrator review.
- The current quiz console generates editable multiple-choice questions (1–20). Other validated text/matching contracts remain accessible through the service. Image-choice, picture-based and counting-object generation returns `AI_MEDIA_REQUIRED` until their renderer-specific asset mappings are supported.
- Lesson generation has an explicit eight-stage response contract. TRY and CHOOSE require two/four unique choices and one matching answer ID. PLAY is a matching mission. LOOK, TAP and completion stages contain real text. No generated progress/reward values override the learner's state.
- Bundled asset IDs are checked at generation and publication. `src/content/bundled-assets.ts` is exported from the frontend registry via `node scripts/export-api-assets.cjs ../Batibot-backend/src/content/bundled-assets.ts`. Remote asset uploads remain a separate feature.
- Content drafts live in PostgreSQL. Network/storage failures are surfaced to administrators, never reported as successful in-memory saves. Approval and publication revalidate saved content. Published content is immutable; revisions require a new draft.
- The legacy Firebase topic-editor workflow is separate from AI stage drafts and was not migrated by this change.

## Verification

`npm run check` runs type checking, linting, automated tests and the production build. AI tests use deterministic provider responses, exercise authorization, generation, validation, persistence across repository instances, review gates, publication, CORS, rate limits, quota and timeout handling. They do not establish real provider availability.

Provider contract references: [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create), [structured output](https://developers.openai.com/api/docs/guides/structured-outputs), [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol).

The OpenAI adapter uses the Responses API with `model: gpt-6.1-sol`, `store: false`, a 16000 output-token cap, and strict JSON Schema. Domain-optional fields are nullable in the provider schema and omitted before domain validation. Incomplete responses and refusals are rejected. There is no model/provider fallback. Existing Gemini-authored saved quizzes remain readable; new quizzes are attributed to `openai`. Legacy request field names such as `geminiContentPrompt` are retained for wire compatibility and do not select the provider.
