import assert from "node:assert/strict";
import { z } from "zod";

export function deploymentOrigin(value: string | undefined): string {
  let url: URL;
  try {
    url = new URL(value ?? "");
  } catch {
    throw new Error("Pass the deployed HTTPS origin, without /api/v1.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Pass the deployed HTTPS origin only, without credentials, path, query, or fragment.");
  }
  return url.origin;
}

// Read-only checks: no login attempts, quiz writes, or learner data creation.
export async function smokeDeployment(origin: string, request: typeof fetch = fetch) {
  const checks = [
    { path: "/health", status: 200, schema: z.object({ data: z.object({
      service: z.literal("batibot-backend"), status: z.literal("healthy"), database: z.literal("connected"),
    }) }) },
    { path: "/api/v1/status", status: 200, schema: z.object({ data: z.object({
      apiVersion: z.literal("v1"), status: z.literal("ready"),
    }) }) },
    { path: "/api/v1/quizzes?limit=1", status: 200, schema: z.object({ data: z.object({ items: z.array(z.unknown()) }) }) },
    ...["/api/v1/auth/me", "/api/v1/learner/progress", "/api/v1/admin/quizzes", "/api/v1/admin/activity-logs"].map(path => ({
      path, status: 401, schema: z.object({ error: z.object({ code: z.literal("AUTH_REQUIRED") }) }),
    })),
  ];
  const passed: string[] = [];
  for (const check of checks) {
    try {
      const response = await request(`${origin}${check.path}`, {
        signal: AbortSignal.timeout(60_000), redirect: "error",
      });
      assert.equal(response.status, check.status);
      assert.ok(response.headers.get("x-request-id"));
      check.schema.parse(await response.json());
      passed.push(check.path);
    } catch {
      // Never echo response bodies, provider error pages, or connection strings.
      throw new Error(`Deployment check failed: ${check.path}. Inspect Render health/logs and retry after cold start.`);
    }
  }
  return passed;
}
