import { hash as hashPassword } from "argon2";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/auth-service.js";
import { UserRepository } from "../src/auth/user-repository.js";
import type { DatabasePool } from "../src/database/pool.js";
import { QuizRepository } from "../src/quizzes/repository.js";
import { createMigratedTestPool } from "./database-test-utils.js";
import { testEnvironment } from "./test-environment.js";

const ADMIN_EMAIL = "admin-monitor@example.test";
const ADMIN_PASSWORD = "Controlled-Test-Password-123!";

describe("admin system monitoring", () => {
  let pool: DatabasePool;
  let users: UserRepository;
  let authService: AuthService;
  let quizzes: QuizRepository;

  beforeEach(async () => {
    pool = await createMigratedTestPool();
    users = new UserRepository(pool);
    authService = new AuthService(pool, users, testEnvironment);
    quizzes = new QuizRepository(pool);
    await users.upsertControlledAdmin({
      displayName: "Monitoring Administrator",
      email: ADMIN_EMAIL,
      passwordHash: await hashPassword(ADMIN_PASSWORD, {
        memoryCost: 4_096,
        timeCost: 2,
      }),
    });
  });

  afterEach(async () => {
    await pool?.end();
  });

  it("requires authentication for monitoring endpoint", async () => {
    const app = createApp(testEnvironment, { authService, quizzes });
    await request(app).get("/api/v1/admin/monitoring").expect(401);
  });

  it("returns server metrics, database latency, and quiz stats for admin", async () => {
    const app = createApp(testEnvironment, {
      authService,
      databaseHealthCheck: async () => {
        await pool.query("SELECT 1");
      },
      quizzes,
    });

    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);

    const token = loginResponse.body.data.accessToken;

    const response = await request(app)
      .get("/api/v1/admin/monitoring")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body.data).toMatchObject({
      status: "healthy",
      environment: "test",
      database: {
        status: "connected",
        latencyMs: expect.any(Number),
      },
      memory: {
        rssBytes: expect.any(Number),
        heapTotalBytes: expect.any(Number),
        heapUsedBytes: expect.any(Number),
      },
      quizzes: {
        totalQuizzes: expect.any(Number),
        publishedQuizzes: expect.any(Number),
        draftQuizzes: expect.any(Number),
      },
      uptimeSeconds: expect.any(Number),
    });
  });

  it("reports degraded health when the database check fails", async () => {
    const app = createApp(testEnvironment, { authService, quizzes, databaseHealthCheck: async () => { throw new Error("database unavailable"); } });
    const token = (await authService.login(ADMIN_EMAIL, ADMIN_PASSWORD)).accessToken;
    const response = await request(app).get("/api/v1/admin/monitoring").set("Authorization", `Bearer ${token}`).expect(200);
    expect(response.body.data).toMatchObject({ status: "degraded", database: { status: "error" }, statisticsStatus: "unavailable" });
  });
});
