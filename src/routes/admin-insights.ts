import { Router } from "express";
import type { AuthService } from "../auth/auth-service.js";
import type { AdminInsightsRepository } from "../analytics/admin-insights-repository.js";
import { sendSuccess } from "../http/responses.js";
import { requireAuthentication, requireRole } from "../middleware/authentication.js";

export function createAdminInsightsRouter(auth: AuthService, repository: AdminInsightsRepository) {
  const router = Router();
  router.use(requireAuthentication(auth), requireRole("admin"));
  router.get("/", async (_request, response) => sendSuccess(response, await repository.load()));
  return router;
}
