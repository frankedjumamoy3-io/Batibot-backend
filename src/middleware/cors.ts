import type { RequestHandler } from "express";
import { sendFailure } from "../http/responses.js";

// Native requests have no Origin. Browser admin access is restricted to explicit hosting origins.
export function allowBrowserOrigins(origins: string[]): RequestHandler {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (!origin) { next(); return; }
    res.vary("Origin");
    if (!origins.includes(origin)) { sendFailure(res, 403, "CORS_ORIGIN_DENIED", "This browser origin is not configured for the API."); return; }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  };
}
