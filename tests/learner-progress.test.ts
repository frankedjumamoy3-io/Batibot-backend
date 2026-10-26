import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/auth-service.js";
import { UserRepository } from "../src/auth/user-repository.js";
import { LearnerProgressRepository } from "../src/learners/progress-repository.js";
import type { DatabasePool } from "../src/database/pool.js";
import { createMigratedTestPool } from "./database-test-utils.js";
import { testEnvironment } from "./test-environment.js";

describe("online learner accounts and durable progress", () => {
  let pool: DatabasePool;
  let app: ReturnType<typeof createApp>;
  const credentials = { email: "learner@example.test", password: "Test-learner-password-123", displayName: "Ana", gradeLevel: "Grade 1" };
  beforeEach(async () => {
    pool = await createMigratedTestPool();
    const authService = new AuthService(pool, new UserRepository(pool), testEnvironment);
    app = createApp(testEnvironment, { authService, learnerProgress: new LearnerProgressRepository(pool) });
  });
  afterEach(async () => { await pool?.end(); });
  async function register(email = credentials.email) {
    return (await request(app).post("/api/v1/auth/register").send({ ...credentials, email }).expect(201)).body.data;
  }

  it("registers and logs in a learner with the saved grade and no admin privileges", async () => {
    const session = await register();
    expect(session.user).toMatchObject({ role: "learner", gradeLevel: "Grade 1", displayName: "Ana" });
    expect(session.user.passwordHash).toBeUndefined();
    const login = await request(app).post("/api/v1/auth/login").send({ email: credentials.email, password: credentials.password }).expect(200);
    expect(login.body.data.user.gradeLevel).toBe("Grade 1");
    await request(app).get("/api/v1/admin/status").set("Authorization", `Bearer ${session.accessToken}`).expect(403);
    await request(app).post("/api/v1/auth/register").send(credentials).expect(409);
    await request(app).post("/api/v1/auth/register").send({ ...credentials, email: "attacker@example.test", role: "admin" }).expect(400);
  });

  it("persists checkpoints across sessions and isolates each authenticated account", async () => {
    const a = await register();
    const b = await register("second@example.test");
    const learnerProgress = { totalXp: 14, lessonCheckpoints: { noun: { stepIndex: 3 } }, claimedWorldRewardIds: ["topic-a"], isTestAccount: true, role: "admin" };
    await request(app).put("/api/v1/learner/progress").send({ expectedVersion: 0, learnerProgress }).expect(401);
    await request(app).put("/api/v1/learner/progress").set("Authorization", `Bearer ${a.accessToken}`).send({ expectedVersion: 0, learnerProgress }).expect(200);
    const saved = await request(app).get("/api/v1/learner/progress").set("Authorization", `Bearer ${a.accessToken}`).expect(200);
    expect(saved.body.data.learnerProgress.lessonCheckpoints.noun.stepIndex).toBe(3);
    expect(saved.body.data.learnerProgress.isTestAccount).toBeUndefined();
    expect(saved.body.data.learnerProgress.role).toBeUndefined();
    const isolated = await request(app).get("/api/v1/learner/progress").set("Authorization", `Bearer ${b.accessToken}`).expect(200);
    expect(isolated.body.data.learnerProgress).toBeNull();
    expect((await new LearnerProgressRepository(pool).load(a.user.id)).version).toBe(1);
  });

  it("rejects stale writes so reconnecting devices must merge instead of erasing newer progress", async () => {
    const session = await register();
    const save = (expectedVersion: number, totalXp: number) => request(app).put("/api/v1/learner/progress")
      .set("Authorization", `Bearer ${session.accessToken}`).send({ expectedVersion, learnerProgress: { totalXp } });
    await save(0, 10).expect(200);
    await save(1, 20).expect(200);
    await save(1, 5).expect(409);
    await save(0, 0).expect(409);
    const saved = await request(app).get("/api/v1/learner/progress").set("Authorization", `Bearer ${session.accessToken}`).expect(200);
    expect(saved.body.data).toMatchObject({ version: 2, learnerProgress: { totalXp: 20 } });
  });
});
