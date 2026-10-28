import { Router } from "express";

import { sendSuccess } from "../http/responses.js";

export const statusRouter = Router();

statusRouter.get("/", (_request, response) => {
  sendSuccess(response, {
    apiVersion: "v1",
    revision: process.env.RENDER_GIT_COMMIT?.slice(0, 12) ?? null,
    service: "batibot-backend",
    status: "ready",
  });
});
