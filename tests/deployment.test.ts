import { describe, expect, it, vi } from "vitest";
import { deploymentOrigin, smokeDeployment } from "../src/deployment/smoke.js";

describe("deployment smoke checks", () => {
  it("accepts only an HTTPS origin without sensitive URL components", () => {
    expect(deploymentOrigin("https://test.onrender.com/")).toBe("https://test.onrender.com");
    for (const value of [undefined, "http://localhost", "https://user:secret@test.onrender.com", "https://test.onrender.com/api/v1", "https://test.onrender.com?secret=1"]) {
      expect(() => deploymentOrigin(value)).toThrow();
    }
  });

  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "x-request-id": "smoke-test" },
  });
  const healthy = () => vi.fn<typeof fetch>()
    .mockResolvedValueOnce(reply({ data: { service: "batibot-backend", status: "healthy", database: "connected" } }))
    .mockResolvedValueOnce(reply({ data: { apiVersion: "v1", status: "ready" } }))
    .mockResolvedValueOnce(reply({ data: { items: [] } }));

  it("checks health, database-backed reads and unauthenticated access without writes", async () => {
    const request = healthy().mockImplementation(async () => reply({ error: { code: "AUTH_REQUIRED" } }, 401));
    expect(await smokeDeployment("https://test.onrender.com", request)).toHaveLength(7);
    expect(request).toHaveBeenCalledTimes(7);
    expect(request.mock.calls.every(([, options]) => !options?.method)).toBe(true);
  });

  it("rejects process-only health and hides response content", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(reply({ data: { database: "not-configured" }, secret: "do-not-print" }));
    await expect(smokeDeployment("https://test.onrender.com", request)).rejects.toThrow("Deployment check failed: /health.");
  });

  it("fails when a protected route becomes public", async () => {
    const request = healthy().mockResolvedValue(reply({ data: {} }));
    await expect(smokeDeployment("https://test.onrender.com", request)).rejects.toThrow("/api/v1/auth/me");
  });

  it("fails when the deployed backend is missing learner progress", async () => {
    const request = healthy()
      .mockResolvedValueOnce(reply({ error: { code: "AUTH_REQUIRED" } }, 401))
      .mockResolvedValueOnce(reply({ error: { code: "NOT_FOUND" } }, 404));
    await expect(smokeDeployment("https://test.onrender.com", request)).rejects.toThrow("/api/v1/learner/progress");
  });
});
