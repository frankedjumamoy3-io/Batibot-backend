import { Router } from "express";

import type { AuthService } from "../auth/auth-service.js";
import type { Environment } from "../config/environment.js";
import { sendSuccess } from "../http/responses.js";
import { requireAuthentication, requireRole } from "../middleware/authentication.js";
import type { QuizRepository } from "../quizzes/repository.js";

export function createMonitoringRouter(
  authService: AuthService,
  environment: Environment,
  quizzes?: QuizRepository,
  databaseHealthCheck?: () => Promise<void>
) {
  const router = Router();

  router.get(
    "/",
    requireAuthentication(authService),
    requireRole("admin"),
    async (_request, response, next) => {
      try {
        const start = Date.now();
        let dbStatus = "not_configured";
        let dbLatencyMs = 0;

        if (databaseHealthCheck) {
          try {
            await databaseHealthCheck();
            dbStatus = "connected";
            dbLatencyMs = Math.max(1, Date.now() - start);
          } catch {
            dbStatus = "error";
            dbLatencyMs = Date.now() - start;
          }
        }

        let quizStats = {
          totalQuizzes: 0,
          publishedQuizzes: 0,
          draftQuizzes: 0,
          archivedQuizzes: 0,
          totalAttempts: 0,
          totalActivityLogs: 0,
        };

        if (quizzes && dbStatus === "connected") {
          try {
            quizStats = await quizzes.stats();
          } catch {
            // Keep zero counts if stats query fails
          }
        }

        const memory = process.memoryUsage();

        sendSuccess(response, {
          database: {
            latencyMs: dbLatencyMs,
            status: dbStatus,
          },
          environment: environment.NODE_ENV,
          memory: {
            externalBytes: memory.external,
            heapTotalBytes: memory.heapTotal,
            heapUsedBytes: memory.heapUsed,
            rssBytes: memory.rss,
          },
          nodeVersion: process.version,
          quizzes: quizStats,
          status: "healthy",
          timestamp: new Date().toISOString(),
          uptimeSeconds: Math.floor(process.uptime()),
        });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
