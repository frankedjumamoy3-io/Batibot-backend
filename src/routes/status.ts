import { Router } from "express";

import { sendSuccess } from "../http/responses.js";

export const statusRouter = Router();

statusRouter.get("/", (_request, response) => {
  sendSuccess(response, {
    apiVersion: "v1",
    service: "batibot-backend",
    status: "ready",
  });
});
