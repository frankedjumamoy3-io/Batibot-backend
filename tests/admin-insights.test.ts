import { hash } from "argon2";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdminInsightsRepository } from "../src/analytics/admin-insights-repository.js";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/auth-service.js";
import { UserRepository } from "../src/auth/user-repository.js";
import type { DatabasePool } from "../src/database/pool.js";
import { createMigratedTestPool } from "./database-test-utils.js";
import { testEnvironment } from "./test-environment.js";

describe("administrator insights", () => {
  let pool: DatabasePool;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let learnerToken: string;
  beforeEach(async () => {
    pool = await createMigratedTestPool();
    const users = new UserRepository(pool);
    const passwordHash = await hash("test-password", { memoryCost: 4096, timeCost: 2 });
    const admin = await users.upsertControlledAdmin({ email: "admin@example.test", displayName: "Admin", passwordHash });
    const learner = await users.createLearner({ email: "learner@example.test", displayName: "Learner", gradeLevel: "Grade 2", passwordHash });
    await pool.query("INSERT INTO learner_progress (user_id, progress) VALUES ($1, $2::jsonb)", [learner.id, JSON.stringify({
      totalXp: 42, completedLessons: ["lesson-one", "lesson-two"], masteredTopics: { topicA: {} },
      quizScores: { "curated-quiz-one": { attempts: 3, percentage: 80 } },
    })]);
    await pool.query("INSERT INTO curated_quizzes (id, title, grade_level, status, created_by, updated_by) VALUES ($1, 'Practice', 'Grade 2', 'published', $2, $2)", [randomUUID(), admin.id]);
    await pool.query("INSERT INTO content_drafts (id, content, grade_level, world_id, status, created_by, updated_by) VALUES ($1, '{}'::jsonb, 'Grade 2', 'grade2-world', 'published', $2, $2)", [randomUUID(), admin.id]);
    const auth = new AuthService(pool, users, testEnvironment);
    adminToken = (await auth.login("admin@example.test", "test-password")).accessToken;
    learnerToken = (await auth.login("learner@example.test", "test-password")).accessToken;
    app = createApp(testEnvironment, { authService: auth, adminInsights: new AdminInsightsRepository(pool) });
  });
  afterEach(async () => { await pool.end(); });

  it("returns saved learner, quiz, and grade metrics to an administrator", async () => {
    const response = await request(app).get("/api/v1/admin/insights").set("Authorization", `Bearer ${adminToken}`).expect(200);
    expect(response.body.data.learners).toMatchObject({ total: 1, active30Days: 1, completedLessons: 2, masteredTopics: 1, savedQuizAttempts: 3, averageLatestScore: 80 });
    expect(response.body.data.learners.byGrade["Grade 2"]).toMatchObject({ learners: 1, completedLessons: 2, savedQuizAttempts: 3 });
    expect(response.body.data.quizPerformance[0]).toMatchObject({ id: "curated-quiz-one", attempts: 3, learners: 1, averageLatestScore: 80 });
    expect(response.body.data.learnerRows[0]).toMatchObject({ displayName: "Learner", totalXp: 42 });
    expect(response.body.data.content.quizStatus.published).toBe(1);
    expect(response.body.data.content.contentStatus.published).toBe(1);
    expect(response.body.data.content.worldCoverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ gradeLevel: "Grade 2", worldId: "grade2-world", publishedStages: 1 }),
    ]));
  });

  it("does not expose insights to learners or anonymous visitors", async () => {
    await request(app).get("/api/v1/admin/insights").expect(401);
    await request(app).get("/api/v1/admin/insights").set("Authorization", `Bearer ${learnerToken}`).expect(403);
  });
});
