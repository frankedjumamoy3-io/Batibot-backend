import { Router } from "express";
import { z } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { sendSuccess } from "../http/responses.js";
import { requireAuthentication, requireRole } from "../middleware/authentication.js";
import type { QuizRepository } from "../quizzes/repository.js";
import { attemptSchema, paginationSchema } from "../quizzes/validation.js";

export function createQuizRouter(repository: QuizRepository, auth: AuthService) {
  const router = Router();
  router.get("/quizzes", async (req, res) => {
    const q = paginationSchema.parse(req.query);
    sendSuccess(res, await repository.list(false, q.limit, q.offset, q.gradeLevel));
  });
  router.get("/quizzes/:id", async (req, res) => sendSuccess(res, await repository.get(z.uuid().parse(req.params.id), false)));
  // Anonymous controlled-test telemetry: strict fields, rate-limited globally,
  // no learner identifiers, always excluded from rankings and analytics.
  router.post("/quiz-attempts", async (req, res) => sendSuccess(res, await repository.attempt(attemptSchema.parse(req.body))));
  router.use("/admin", requireAuthentication(auth), requireRole("admin"));
  router.get("/admin/quizzes", async (req, res) => {
    const q = paginationSchema.parse(req.query);
    sendSuccess(res, await repository.list(true, q.limit, q.offset, q.gradeLevel));
  });
  router.get("/admin/quizzes/:id", async (req, res) => sendSuccess(res, await repository.get(z.uuid().parse(req.params.id), true)));
  router.post("/admin/quizzes", async (req, res) => sendSuccess(res, await repository.write(req.body, req.authUser!.id)));
  router.patch("/admin/quizzes/:id", async (req, res) => {
    const input = z.record(z.string(), z.unknown()).parse(req.body);
    sendSuccess(res, await repository.write(input, req.authUser!.id, z.uuid().parse(req.params.id), true));
  });
  router.delete("/admin/quizzes/:id", async (req, res) => {
    await repository.remove(z.uuid().parse(req.params.id), req.authUser!.id);
    sendSuccess(res, { deleted: true });
  });
  router.get("/admin/activity-logs", async (req, res) => {
    const q = paginationSchema.parse(req.query);
    sendSuccess(res, await repository.activity(q.limit, q.offset));
  });
  return router;
}
