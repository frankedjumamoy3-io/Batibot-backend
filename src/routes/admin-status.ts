import { Router } from "express";

import type { AuthService } from "../auth/auth-service.js";
import { sendSuccess } from "../http/responses.js";
import { requireAuthentication, requireRole } from "../middleware/authentication.js";

export function createAdminStatusRouter(authService: AuthService) {
  const router = Router();

  router.get(
    "/",
    requireAuthentication(authService),
    requireRole("admin"),
    (request, response) => {
      sendSuccess(response, {
        role: request.authUser!.role,
        status: "ready",
      });
    }
  );

  return router;
}
