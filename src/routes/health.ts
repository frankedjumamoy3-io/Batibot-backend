import { Router } from "express";

import { sendSuccess } from "../http/responses.js";

export const healthRouter = Router();

healthRouter.get("/", (_request, response) => {
  sendSuccess(response, {
    service: "batibot-backend",
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
});
