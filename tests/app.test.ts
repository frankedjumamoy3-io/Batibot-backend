import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import type { Environment } from "../src/config/environment.js";

const testEnvironment: Environment = {
  LOG_LEVEL: "silent",
  NODE_ENV: "test",
  PORT: 3_000,
};

describe("BatiBot API foundation", () => {
  const app = createApp(testEnvironment);

  it("reports process health with a request ID", async () => {
    const response = await request(app).get("/health").expect(200);

    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
    expect(response.body).toMatchObject({
      data: {
        service: "batibot-api",
        status: "healthy",
      },
      meta: {
        requestId: response.headers["x-request-id"],
      },
    });
  });

  it("reports the versioned API status", async () => {
    const response = await request(app).get("/api/v1/status").expect(200);

    expect(response.body.data).toEqual({
      apiVersion: "v1",
      service: "batibot-api",
      status: "ready",
    });
  });

  it("returns a stable error envelope for unknown routes", async () => {
    const response = await request(app).get("/missing").expect(404);

    expect(response.body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "The requested resource was not found.",
        requestId: response.headers["x-request-id"],
      },
    });
  });

  it("preserves a safe caller-supplied request ID", async () => {
    const response = await request(app)
      .get("/api/v1/status")
      .set("X-Request-Id", "controlled-test-request")
      .expect(200);

    expect(response.headers["x-request-id"]).toBe("controlled-test-request");
    expect(response.body.meta.requestId).toBe("controlled-test-request");
  });
});
