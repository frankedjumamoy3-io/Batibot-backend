import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import type { AuthService } from "../auth/auth-service.js";
import { sendSuccess } from "../http/responses.js";
import { requireAuthentication } from "../middleware/authentication.js";

const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(256),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(32).max(512),
});

const authenticationRateLimit = rateLimit({
  handler: (_request, response) => {
    response.status(429).json({
      error: {
        code: "AUTH_RATE_LIMITED",
        message: "Too many authentication attempts. Please wait and try again.",
        requestId: String(response.locals.requestId ?? "unknown"),
      },
    });
  },
  legacyHeaders: false,
  limit: 30,
  standardHeaders: "draft-8",
  windowMs: 15 * 60_000,
});

export function createAuthRouter(authService: AuthService) {
  const router = Router();

  router.post("/login", authenticationRateLimit, async (request, response) => {
    const input = loginSchema.parse(request.body);
    const session = await authService.login(input.email, input.password);
    sendSuccess(response, session);
  });

  router.post("/refresh", authenticationRateLimit, async (request, response) => {
    const input = refreshSchema.parse(request.body);
    const session = await authService.refresh(input.refreshToken);
    sendSuccess(response, session);
  });

  router.post("/logout", async (request, response) => {
    const input = refreshSchema.parse(request.body);
    await authService.logout(input.refreshToken);
    sendSuccess(response, { loggedOut: true });
  });

  router.get("/me", requireAuthentication(authService), (request, response) => {
    sendSuccess(response, { user: request.authUser! });
  });

  return router;
}
