import { hash } from "argon2";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/auth-service.js";
import { UserRepository } from "../src/auth/user-repository.js";
import type { DatabasePool } from "../src/database/pool.js";
import { QuizRepository } from "../src/quizzes/repository.js";
import { createMigratedTestPool } from "./database-test-utils.js";
import { testEnvironment } from "./test-environment.js";

const draft = {
  title: "Meet the family", topic: "Mother", objective: "Recognize Mother", instructions: "Choose the word.",
  gradeLevel: "Preschool", learnerLevel: "Preschool", worldId: "preschool-family-world", topicId: "Mother", phase: "Practice",
  category: "linguistic", difficulty: "beginner", curriculumLevel: 1, questionTypes: ["multiple-choice"], rewards: { xp: 20 },
  mobilePreviewChecked: true,
  reviewChecklist: { ageAppropriate: true, objectiveClear: true, instructionsUnderstandable: true, questionsComplete: true, answersValid: true, noDuplicateQuestions: true, noBrokenMatchingPairs: true, noLowQualityAiOutput: true, topicMatchesCurriculum: true, questionCountAcceptable: true },
  questions: [{ id: "q1", type: "multiple-choice", prompt: "Choose Mother.", options: ["Mother", "Father"], answer: "Mother" }],
};
describe("controlled quiz API", () => {
  let pool: DatabasePool;
  let app: ReturnType<typeof createApp>;
  let token: string;
  beforeEach(async () => {
    pool = await createMigratedTestPool();
    const users = new UserRepository(pool);
    await users.upsertControlledAdmin({ email: "admin@example.test", displayName: "Admin", passwordHash: await hash("test-password", { memoryCost: 4096, timeCost: 2 }) });
    const auth = new AuthService(pool, users, testEnvironment);
    token = (await auth.login("admin@example.test", "test-password")).accessToken;
    app = createApp(testEnvironment, { authService: auth, quizzes: new QuizRepository(pool) });
  });
  afterEach(async () => { await pool.end(); });
  const bearer = () => `Bearer ${token}`;

  it("creates, publishes, reads, unpublishes and deletes with audit records", async () => {
    const created = await request(app).post("/api/v1/admin/quizzes").set("Authorization", bearer()).send(draft).expect(200);
    const id = created.body.data.id;
    await request(app).get(`/api/v1/quizzes/${id}`).expect(404);
    expect((await request(app).get("/api/v1/quizzes")).body.data.items).toHaveLength(0);
    await request(app).patch(`/api/v1/admin/quizzes/${id}`).set("Authorization", bearer()).send({ status: "published" }).expect(200);
    const published = await request(app).get(`/api/v1/quizzes/${id}`).expect(200);
    expect(published.body.data.questions[0].answer).toBe("Mother");
    expect(published.body.data.createdByUid).toBeUndefined();
    await request(app).delete(`/api/v1/admin/quizzes/${id}`).set("Authorization", bearer()).expect(409);
    await request(app).patch(`/api/v1/admin/quizzes/${id}`).set("Authorization", bearer()).send({ status: "ready-for-review" }).expect(200);
    await request(app).get(`/api/v1/quizzes/${id}`).expect(404);
    await request(app).delete(`/api/v1/admin/quizzes/${id}`).set("Authorization", bearer()).expect(200);
    const logs = await request(app).get("/api/v1/admin/activity-logs").set("Authorization", bearer()).expect(200);
    expect(logs.body.data.items).toHaveLength(4);
  });

  it("rejects impossible choices, equivalent duplicates and invalid curriculum assignments", async () => {
    for (const changes of [
      { questions: [{ ...draft.questions[0], answer: "Baby" }] },
      { questions: [{ ...draft.questions[0], options: ["1", "one"], answer: "1" }] },
      { gradeLevel: "Grade 3", learnerLevel: "Grade 3" },
      { topicId: "unavailable-topic" },
      { phase: "unknown" },
    ]) await request(app).post("/api/v1/admin/quizzes").set("Authorization", bearer()).send({ ...draft, ...changes }).expect(400);
    expect((await pool.query("SELECT * FROM curated_quizzes")).rowCount).toBe(0);
  });

  it("enforces authorization for every admin method", async () => {
    await request(app).post("/api/v1/admin/quizzes").send(draft).expect(401);
    await request(app).get("/api/v1/admin/activity-logs").expect(401);
    await pool.query("UPDATE app_users SET role='tester'");
    await request(app).post("/api/v1/admin/quizzes").set("Authorization", bearer()).send(draft).expect(403);
    await request(app).get("/api/v1/admin/quizzes").set("Authorization", bearer()).expect(403);
  });

  it("canonicalizes the correct visible choice and rejects publishing without review", async () => {
    const created = await request(app).post("/api/v1/admin/quizzes").set("Authorization", bearer()).send({ ...draft,
      mobilePreviewChecked: false, questions: [{ ...draft.questions[0], options: ["1", "2"], answer: "one" }],
    }).expect(200);
    expect(created.body.data.questions[0].answer).toBe("1");
    const id = created.body.data.id;
    await request(app).patch(`/api/v1/admin/quizzes/${id}`).set("Authorization", bearer()).send({ status: "published" }).expect(400);
    await request(app).patch(`/api/v1/admin/quizzes/${id}`).set("Authorization", bearer()).send({ questions: [{ ...draft.questions[0], answer: "missing" }] }).expect(400);
    const unchanged = await request(app).get(`/api/v1/admin/quizzes/${id}`).set("Authorization", bearer()).expect(200);
    expect(unchanged.body.data.questions[0].answer).toBe("1");
    expect(unchanged.body.data.version).toBe(1);
  });

  it("paginates and accepts only sanitized test attempts for published quizzes", async () => {
    const created = await request(app).post("/api/v1/admin/quizzes").set("Authorization", bearer()).send({ ...draft, status: "published" }).expect(200);
    await request(app).post("/api/v1/admin/quizzes").set("Authorization", bearer()).send({ ...draft, status: "published" }).expect(200);
    const page = await request(app).get("/api/v1/quizzes?limit=1").expect(200);
    expect(page.body.data.items).toHaveLength(1);
    expect(page.body.data.nextOffset).toBe(1);
    await request(app).get("/api/v1/quizzes?limit=1000").expect(400);
    const attempt = { quizId: created.body.data.id, score: 1, totalQuestions: 1 };
    await request(app).post("/api/v1/quiz-attempts").send({ ...attempt, learnerEmail: "private@example.test" }).expect(400);
    await request(app).post("/api/v1/quiz-attempts").send({ ...attempt, score: 2 }).expect(400);
    await request(app).post("/api/v1/quiz-attempts").send(attempt).expect(200);
    expect((await pool.query("SELECT * FROM quiz_attempts")).rows[0]).toMatchObject({ learner_profile_id: null, is_test_account: true, exclude_from_analytics: true, exclude_from_leaderboard: true });
  });
});
