import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { testEnvironment } from "./test-environment.js";

describe("BatiBot API foundation", () => {
  const app = createApp(testEnvironment);

  it("trusts only the configured nearest proxy", async () => {
    const proxied = createApp({ ...testEnvironment, TRUST_PROXY_HOPS: 1 });
    // Do not trust earlier, caller-supplied entries in X-Forwarded-For.
    const trust = proxied.get("trust proxy fn") as (ip: string, hop: number) => boolean;
    expect(trust("127.0.0.1", 0)).toBe(true);
    expect(trust("203.0.113.1", 1)).toBe(false);
    expect(app.get("trust proxy")).toBe(0);
    await request(proxied).get("/health").set("X-Forwarded-For", "198.51.100.1, 203.0.113.1").expect(200);
  });

  it("reports process health with a request ID", async () => {
    const response = await request(app).get("/health").expect(200);

    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
    expect(response.body).toMatchObject({
      data: {
        service: "batibot-backend",
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
      revision: process.env.RENDER_GIT_COMMIT?.slice(0, 12) ?? null,
      service: "batibot-backend",
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
