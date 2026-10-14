import { Router } from "express";

import { ApiError } from "../http/api-error.js";
import { sendSuccess } from "../http/responses.js";

export function createHealthRouter(databaseHealthCheck?: () => Promise<void>) {
  const router = Router();

  router.get("/", async (_request, response) => {
    if (databaseHealthCheck) {
      try {
        await databaseHealthCheck();
      } catch {
        throw new ApiError(503, "SERVICE_UNAVAILABLE", "The service is temporarily unavailable.");
      }
    }

    sendSuccess(response, {
      database: databaseHealthCheck ? "connected" : "not-configured",
      service: "batibot-backend",
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  return router;
}
