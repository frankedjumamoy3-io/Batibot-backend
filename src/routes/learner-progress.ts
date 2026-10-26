import { Router } from "express";
import { z } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import type { LearnerProgressRepository } from "../learners/progress-repository.js";
import { requireAuthentication } from "../middleware/authentication.js";
import { sendSuccess } from "../http/responses.js";

const inputSchema = z.object({
  expectedVersion: z.number().int().min(0),
  learnerProgress: z.record(z.string(), z.unknown()),
}).strict();

export function createLearnerProgressRouter(auth: AuthService, progress: LearnerProgressRepository) {
  const router = Router();
  router.use(requireAuthentication(auth));
  router.get("/", async (request, response) => {
    sendSuccess(response, await progress.load(request.authUser!.id));
  });
  router.put("/", async (request, response) => {
    const input = inputSchema.parse(request.body);
    // Progress never controls account privileges or test-mode access.
    delete input.learnerProgress.isTestAccount;
    delete input.learnerProgress.unlockAllQuizzes;
    delete input.learnerProgress.role;
    sendSuccess(response, await progress.save(request.authUser!.id, input.learnerProgress, input.expectedVersion));
  });
  return router;
}
