import { Router } from "express";
import { z } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import type { ContentRepository } from "../content/repository.js";
import { sendSuccess } from "../http/responses.js";
import { requireAuthentication, requireRole } from "../middleware/authentication.js";
import { paginationSchema } from "../quizzes/validation.js";

export function createContentRouter(auth: AuthService, repository: ContentRepository) {
  const router = Router();
  router.get("/published-content", async (req, res) => {
    const q = paginationSchema.extend({ worldId: z.string().max(200).optional() }).parse(req.query);
    sendSuccess(res, await repository.published(false, q.limit, q.offset, q.gradeLevel, q.worldId));
  });
  router.use("/admin", requireAuthentication(auth), requireRole("admin"));
  router.get("/admin/content-drafts", async (req, res) => { const q = paginationSchema.parse(req.query); sendSuccess(res, await repository.list(q.limit, q.offset)); });
  router.get("/admin/content-drafts/:id", async (req, res) => sendSuccess(res, await repository.get(z.uuid().parse(req.params.id))));
  router.post("/admin/content-drafts", async (req, res) => sendSuccess(res, await repository.write(req.body, req.authUser!.id)));
  router.patch("/admin/content-drafts/:id", async (req, res) => sendSuccess(res, await repository.write(req.body, req.authUser!.id, z.uuid().parse(req.params.id))));
  router.post("/admin/content-drafts/:id/publish", async (req, res) => sendSuccess(res, await repository.write({}, req.authUser!.id, z.uuid().parse(req.params.id), true)));
  router.get("/admin/published-content", async (req, res) => { const q = paginationSchema.parse(req.query); sendSuccess(res, await repository.published(true, q.limit, q.offset)); });
  return router;
}
