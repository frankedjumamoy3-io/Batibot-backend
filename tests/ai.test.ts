import { hash } from "argon2";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/auth-service.js";
import { UserRepository } from "../src/auth/user-repository.js";
import { OpenAIGenerator, type ContentGenerator } from "../src/ai/openai.js";
import { strictOutputSchema } from "../src/ai/structured-output.js";
import { quizOutputSchema } from "../src/ai/quiz-generation.js";
import { generatedContentSchema } from "../src/content/validation.js";
import { z } from "zod";
import { loadEnvironment } from "../src/config/environment.js";
import { ContentRepository } from "../src/content/repository.js";
import { stageLabels } from "../src/content/validation.js";
import type { DatabasePool } from "../src/database/pool.js";
import { QuizRepository } from "../src/quizzes/repository.js";
import { createMigratedTestPool } from "./database-test-utils.js";
import { testEnvironment } from "./test-environment.js";

const input = { topic: "Mother", gradeLevel: "Preschool", learnerLevel: "Preschool", worldId: "preschool-family-world", topicId: "Mother", phase: "Practice", category: "linguistic", curriculumLevel: 1, difficulty: "beginner", questionCount: 1, questionTypes: ["multiple-choice"], adminPrompt: "Family words" };
const quizOutput = { title: "Family words", objective: "Identify Mother", instructions: "Choose the word.", questions: [{ id: "q1", type: "multiple-choice", prompt: "Who is a female parent?", options: ["Mother", "Father"], answer: "Mother", explanation: "A mother is a female parent." }] };
const refs = { images: [], audio: [], backgrounds: [], icons: [] };
const contentOutput = {
  title: "Mother", topicTitle: "Mother", topicType: "concept", content: "A mother is a parent.", instruction: "Look at the family.", feedbackCorrect: "Great!", feedbackIncorrect: "Try again.", examples: [{ label: "Mother", explanation: "A mother is a parent." }], assetRefs: refs,
  stages: stageLabels.map(stageLabel => ({ id: stageLabel.toLowerCase(), stageLabel, title: "Mother", activityType: stageLabel === "PLAY" ? "matching" : "concept", instruction: "Explore the family.", body: "A mother is a parent.", meaning: "A mother is a parent.", question: "Who is a female parent?", feedbackCorrect: "Great!", feedbackIncorrect: "Try again.", assetRefs: refs,
    ...(["TRY", "CHOOSE"].includes(stageLabel) ? { choices: [{ id: "mother", label: "Mother", isCorrect: true }, { id: "father", label: "Father", isCorrect: false }], correctAnswer: "mother" } : {}),
    ...(stageLabel === "PLAY" ? { items: [{ id: "a", left: "Mother", right: "Female parent" }, { id: "b", left: "Father", right: "Male parent" }] } : {}),
  })),
};
const contentInput = { ...input, topicTitle: "Mother", topicType: "concept", request: { stageType: "LOOK" }, metadata: { ...input, topicTitle: "Mother", stageType: "LOOK", existingAssetRefs: refs, contentRules: { ageAppropriate: true }, learnerUiSchema: { requiresChoices: false, requiresCorrectAnswer: false, supportsAssets: true } }, geminiContentPrompt: "Family lesson", geminiDraftPrompt: "Eight distinct learning stages" };
const checks = Object.fromEntries(["ageAppropriate", "objectiveClear", "instructionsUnderstandable", "questionsComplete", "answersValid", "noDuplicateQuestions", "noBrokenMatchingPairs", "noLowQualityAiOutput", "topicMatchesCurriculum", "questionCountAcceptable"].map(key => [key, true]));

describe("admin AI workflows", () => {
  let pool: DatabasePool;
  let app: ReturnType<typeof createApp>;
  let auth: AuthService;
  let token: string;
  let generator: ContentGenerator;
  beforeEach(async () => {
    pool = await createMigratedTestPool();
    const users = new UserRepository(pool);
    await users.upsertControlledAdmin({ email: "ai-admin@example.test", displayName: "Admin", passwordHash: await hash("test-password", { memoryCost: 4096, timeCost: 2 }) });
    auth = new AuthService(pool, users, testEnvironment);
    token = (await auth.login("ai-admin@example.test", "test-password")).accessToken;
    generator = { configured: true, model: "gpt-6.1-sol", generate: vi.fn(async () => structuredClone(quizOutput)) };
    app = createApp(testEnvironment, { authService: auth, generator, quizzes: new QuizRepository(pool), content: new ContentRepository(pool) });
  });
  afterEach(async () => { await pool.end(); });
  const bearer = () => `Bearer ${token}`;

  it("generates, saves, reopens and publishes a reviewed quiz; drafts are private", async () => {
    const result = await request(app).post("/api/v1/admin/ai/quizzes").set("Authorization", bearer()).send(input).expect(200);
    const quiz = result.body.data.quiz;
    expect(quiz).toMatchObject({ createdWith: "openai", modelName: "gpt-6.1-sol", mobilePreviewChecked: false, status: "draft" });
    expect((await pool.query("SELECT * FROM curated_quizzes")).rowCount).toBe(0);
    const saved = await request(app).post("/api/v1/admin/quizzes").set("Authorization", bearer()).send(quiz).expect(200);
    const id = saved.body.data.id;
    await request(app).get(`/api/v1/quizzes/${id}`).expect(404);
    await request(app).patch(`/api/v1/admin/quizzes/${id}`).set("Authorization", bearer()).send({ status: "published" }).expect(400);
    const reopened = await request(app).get(`/api/v1/admin/quizzes/${id}`).set("Authorization", bearer()).expect(200);
    expect(reopened.body.data.modelName).toBe("gpt-6.1-sol");
    await request(app).patch(`/api/v1/admin/quizzes/${id}`).set("Authorization", bearer()).send({ mobilePreviewChecked: true, reviewChecklist: checks, status: "published" }).expect(200);
    const publicQuiz = await request(app).get(`/api/v1/quizzes/${id}`).expect(200);
    expect(publicQuiz.body.data.questions[0].answer).toBe("Mother");
    expect(publicQuiz.body.data.sourcePrompt).toBeUndefined();
  });

  it("rejects unauthorized, out-of-scope and malformed requests before calling OpenAI", async () => {
    await request(app).post("/api/v1/admin/ai/quizzes").send(input).expect(401);
    await request(app).post("/api/v1/admin/ai/quizzes").set("Authorization", bearer()).send({ ...input, questionCount: 100 }).expect(400);
    await request(app).post("/api/v1/admin/ai/quizzes").set("Authorization", bearer()).send({ ...input, topicId: "unknown" }).expect(400);
    expect(generator.generate).not.toHaveBeenCalled();
    await pool.query("UPDATE app_users SET role='learner'");
    await request(app).post("/api/v1/admin/ai/content").set("Authorization", bearer()).send(contentInput).expect(403);
    await request(app).get("/api/v1/admin/content-drafts").set("Authorization", bearer()).expect(403);
  });

  it("rejects invalid answers, duplicate choices, count mismatches and model publication claims", async () => {
    for (const changes of [{ answer: "Baby" }, { options: ["1", "one"], answer: "1" }]) {
      vi.mocked(generator.generate).mockResolvedValueOnce({ ...quizOutput, questions: [{ ...quizOutput.questions[0], ...changes }] });
      const result = await request(app).post("/api/v1/admin/ai/quizzes").set("Authorization", bearer()).send(input).expect(422);
      expect(result.body.error.code).toBe("AI_INVALID_OUTPUT");
    }
    await request(app).post("/api/v1/admin/ai/quizzes").set("Authorization", bearer()).send({ ...input, questionCount: 2 }).expect(422);
    vi.mocked(generator.generate).mockResolvedValueOnce({ ...quizOutput, status: "published", reviewChecklist: checks, mobilePreviewChecked: true });
    const result = await request(app).post("/api/v1/admin/ai/quizzes").set("Authorization", bearer()).send(input).expect(200);
    expect(result.body.data.quiz.status).toBe("draft");
    expect(result.body.data.quiz.reviewChecklist).toEqual({});
    vi.mocked(generator.generate).mockResolvedValueOnce({ ...quizOutput, questions: [{ id: "image-q", type: "image-to-word", prompt: "Match the family pictures.", pairs: [{ left: "Mother", right: "Mother" }, { left: "Father", right: "Father" }] }] });
    await request(app).post("/api/v1/admin/ai/quizzes").set("Authorization", bearer()).send({ ...input, questionTypes: ["image-to-word"] }).expect(422);
  });

  it("reports missing credentials honestly and limits generation per administrator", async () => {
    const missing = createApp(testEnvironment, { authService: auth });
    expect((await request(missing).get("/api/v1/admin/ai/status").set("Authorization", bearer()).expect(200)).body.data.configured).toBe(false);
    expect((await request(missing).post("/api/v1/admin/ai/quizzes").set("Authorization", bearer()).send(input).expect(503)).body.error.code).toBe("AI_NOT_CONFIGURED");
    for (let i = 0; i < 6; i++) await request(app).post("/api/v1/admin/ai/quizzes").set("Authorization", bearer()).send(input).expect(200);
    await request(app).post("/api/v1/admin/ai/quizzes").set("Authorization", bearer()).send(input).expect(429);
    expect(generator.generate).toHaveBeenCalledTimes(6);
  });

  it("persists lesson drafts across repository instances and only exposes approved published content", async () => {
    vi.mocked(generator.generate).mockResolvedValueOnce(contentOutput);
    const generated = (await request(app).post("/api/v1/admin/ai/content").set("Authorization", bearer()).send(contentInput).expect(200)).body.data.draft;
    const payload = { ...contentInput, adminPrompt: "Family lesson", contentKind: "activity", assetRefs: refs, stageType: "LOOK", requestId: "mother-look", generatedContent: generated, editedContent: generated, status: "ai_generated", validationResults: [{ severity: "success", code: "reviewed" }] };
    const saved = (await request(app).post("/api/v1/admin/content-drafts").set("Authorization", bearer()).send(payload).expect(200)).body.data;
    const id = saved.id;
    expect((await new ContentRepository(pool).get(id)).topicTitle).toBe("Mother");
    expect((await request(app).get("/api/v1/published-content")).body.data.items).toEqual([]);
    await request(app).post(`/api/v1/admin/content-drafts/${id}/publish`).set("Authorization", bearer()).expect(409);
    await request(app).patch(`/api/v1/admin/content-drafts/${id}`).set("Authorization", bearer()).send({ status: "needs_review" }).expect(200);
    await request(app).patch(`/api/v1/admin/content-drafts/${id}`).set("Authorization", bearer()).send({ status: "approved" }).expect(200);
    await request(app).patch(`/api/v1/admin/content-drafts/${id}`).set("Authorization", bearer()).send({ status: "published" }).expect(409);
    await request(app).post(`/api/v1/admin/content-drafts/${id}/publish`).set("Authorization", bearer()).expect(200);
    const published = (await request(app).get(`/api/v1/published-content?gradeLevel=${encodeURIComponent("Preschool")}&worldId=preschool-family-world`).expect(200)).body.data.items[0];
    expect(published.content.stages).toHaveLength(8);
    expect(published.adminPrompt).toBeUndefined();
    expect(published.publishedBy).toBeUndefined();
    await request(app).patch(`/api/v1/admin/content-drafts/${id}`).set("Authorization", bearer()).send({ status: "draft" }).expect(409);
  });

  it("rejects incomplete lesson generation and invented asset references", async () => {
    for (const output of [{ ...contentOutput, stages: [] }, { ...contentOutput, assetRefs: { ...refs, images: ["invented"] } }]) {
      vi.mocked(generator.generate).mockResolvedValueOnce(output);
      await request(app).post("/api/v1/admin/ai/content").set("Authorization", bearer()).send(contentInput).expect(422);
    }
  });

  it("rejects invalid saved lesson answers at approval even when client validation claims success", async () => {
    const broken = structuredClone(contentOutput);
    broken.stages.find(stage => stage.stageLabel === "TRY")!.correctAnswer = "missing";
    const payload = { ...contentInput, adminPrompt: "Family lesson", contentKind: "activity", assetRefs: refs, stageType: "LOOK", requestId: "mother-look", generatedContent: broken, editedContent: broken, status: "needs_review", validationResults: [{ severity: "pass" }] };
    const saved = (await request(app).post("/api/v1/admin/content-drafts").set("Authorization", bearer()).send(payload).expect(200)).body.data;
    await request(app).patch(`/api/v1/admin/content-drafts/${saved.id}`).set("Authorization", bearer()).send({ status: "approved" }).expect(400);
    expect((await new ContentRepository(pool).get(saved.id)).status).toBe("needs_review");
  });

  it("allows browser preflight only from configured origins", async () => {
    const browserApp = createApp({ ...testEnvironment, CORS_ALLOWED_ORIGINS: ["https://admin.example.test"] }, { authService: auth, generator });
    const allowed = await request(browserApp).options("/api/v1/admin/ai/quizzes").set("Origin", "https://admin.example.test").set("Access-Control-Request-Method", "POST").expect(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://admin.example.test");
    await request(browserApp).options("/api/v1/admin/ai/quizzes").set("Origin", "https://unknown.example.test").expect(403);
  });
});

describe("OpenAI Responses transport", () => {
  it("defaults to the requested model and never falls back to a Gemini key", () => {
    const environment = loadEnvironment({ GEMINI_API_KEY: "old-key" });
    expect(environment.OPENAI_MODEL).toBe("gpt-6.1-sol");
    expect(new OpenAIGenerator(environment).configured).toBe(false);
  });
  it("sends structured output schema with server credentials and parses a complete response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: "completed", output: [{ type: "reasoning" }, { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(quizOutput) }] }] })));
    const generator = new OpenAIGenerator({ ...testEnvironment, OPENAI_API_KEY: "test-secret" }, fetcher);
    expect(await generator.generate("test prompt", { type: "object" })).toEqual(quizOutput);
    expect(fetcher.mock.calls[0]![0]).not.toContain("test-secret");
    const requestBody = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
    expect(fetcher.mock.calls[0]![0]).toBe("https://api.openai.com/v1/responses");
    expect(requestBody).toMatchObject({ model: "gpt-6.1-sol", store: false, max_output_tokens: 16000, input: "test prompt" });
    expect(requestBody.text.format).toEqual({ type: "json_schema", name: "batibot_draft", strict: true, schema: { type: "object", properties: {}, required: [], additionalProperties: false } });
    expect(fetcher.mock.calls[0]![1]!.headers).toMatchObject({ Authorization: "Bearer test-secret" });
  });
  it("handles quota, provider failures, malformed JSON, blocked and truncated output without leaking secrets", async () => {
    for (const [status, body, code] of [
      [429, "private provider details", "AI_QUOTA_EXCEEDED"], [403, "private key", "AI_CONFIGURATION_ERROR"], [500, "private error", "AI_UNAVAILABLE"],
      [404, "private model access error", "AI_CONFIGURATION_ERROR"],
      [200, '{"status":"incomplete","output":[]}', "AI_INVALID_OUTPUT"],
      [200, '{"status":"completed","output":[{"type":"message","role":"assistant","status":"completed","content":[{"type":"refusal","refusal":"No"}]}]}', "AI_INVALID_OUTPUT"],
      [200, '{"status":"completed","output":[{"type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"invalid"}]}]}', "AI_INVALID_OUTPUT"],
      [200, '{"status":"completed","output":[]}', "AI_INVALID_OUTPUT"],
    ] as const) {
      const generator = new OpenAIGenerator({ ...testEnvironment, OPENAI_API_KEY: "test-secret" }, vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status })));
      await expect(generator.generate("test", {})).rejects.toMatchObject({ code });
    }
  });
  it("aborts a slow provider without retrying a billed request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("aborted")))));
    const generator = new OpenAIGenerator({ ...testEnvironment, OPENAI_API_KEY: "test-secret", AI_TIMEOUT_MS: 10 }, fetcher);
    await expect(generator.generate("test", {})).rejects.toMatchObject({ code: "AI_TIMEOUT" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("makes both nested output schemas strict while preserving optional field semantics", async () => {
    function check(node: Record<string, unknown>) {
      if (node.type === "object") {
        expect(node.additionalProperties).toBe(false);
        expect(node.required).toEqual(Object.keys(node.properties as object));
        Object.values(node.properties as object).forEach(value => check(value));
      }
      if (node.items) check(node.items as Record<string, unknown>);
      if (Array.isArray(node.anyOf)) node.anyOf.forEach(check);
    }
    for (const schema of [quizOutputSchema, z.toJSONSchema(generatedContentSchema)]) check(strictOutputSchema(schema));
    const output = { ...quizOutput, questions: [{ ...quizOutput.questions[0], pairs: null, sentence: null, audioText: null }] };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: "completed", output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(output) }] }] })));
    expect(await new OpenAIGenerator({ ...testEnvironment, OPENAI_API_KEY: "test-secret" }, fetcher).generate("test", quizOutputSchema)).toEqual(quizOutput);
  });
});
