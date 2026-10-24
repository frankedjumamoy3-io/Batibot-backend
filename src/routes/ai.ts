import { Router } from "express";
import rateLimit from "express-rate-limit";
import type { AuthService } from "../auth/auth-service.js";
import type { ContentGenerator } from "../ai/openai.js";
import { generateQuiz, quizGenerationRequest } from "../ai/quiz-generation.js";
import { generateLesson } from "../ai/content-generation.js";
import { contentGenerationRequest } from "../content/validation.js";
import { requireAuthentication, requireRole } from "../middleware/authentication.js";
import { sendSuccess, sendFailure } from "../http/responses.js";

export function createAiRouter(auth: AuthService, generator: ContentGenerator) {
  const router = Router();
  router.use(requireAuthentication(auth), requireRole("admin"));
  router.get("/status", (_req, res) => sendSuccess(res, { configured: generator.configured, model: generator.model }));
  router.use(rateLimit({ windowMs: 60_000, limit: 6, standardHeaders: "draft-8", legacyHeaders: false,
    keyGenerator: req => req.authUser!.id,
    handler: (_req, res) => sendFailure(res, 429, "AI_RATE_LIMITED", "Wait a minute before generating another draft."),
  }));
  router.post("/quizzes", async (req, res) => sendSuccess(res, { quiz: await generateQuiz(quizGenerationRequest.parse(req.body), generator) }));
  router.post("/content", async (req, res) => sendSuccess(res, { draft: await generateLesson(contentGenerationRequest.parse(req.body), generator) }));
  return router;
}
