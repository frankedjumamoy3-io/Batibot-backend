import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";

import type { AuthService } from "./auth/auth-service.js";
import type { Environment } from "./config/environment.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requestContext } from "./middleware/request-context.js";
import { createAdminStatusRouter } from "./routes/admin-status.js";
import { createAuthRouter } from "./routes/auth.js";
import { createHealthRouter } from "./routes/health.js";
import { createMonitoringRouter } from "./routes/monitoring.js";
import { createAdminInsightsRouter } from "./routes/admin-insights.js";
import type { AdminInsightsRepository } from "./analytics/admin-insights-repository.js";
import { statusRouter } from "./routes/status.js";
import { createQuizRouter } from "./routes/quizzes.js";
import type { QuizRepository } from "./quizzes/repository.js";
import { OpenAIGenerator, type ContentGenerator } from "./ai/openai.js";
import type { ContentRepository } from "./content/repository.js";
import { createAiRouter } from "./routes/ai.js";
import { createContentRouter } from "./routes/content.js";
import { allowBrowserOrigins } from "./middleware/cors.js";
import type { LearnerProgressRepository } from "./learners/progress-repository.js";
import { createLearnerProgressRouter } from "./routes/learner-progress.js";

export interface ApplicationDependencies {
  adminInsights?: AdminInsightsRepository;
  learnerProgress?: LearnerProgressRepository;
  generator?: ContentGenerator;
  content?: ContentRepository;
  quizzes?: QuizRepository;
  authService?: AuthService;
  databaseHealthCheck?: () => Promise<void>;
}

export function createApp(
  environment: Environment,
  dependencies: ApplicationDependencies = {}
) {
  const app = express();

  app.disable("x-powered-by");
  // Trust only the nearest proxy on Render; never trust arbitrary forwarded headers.
  app.set("trust proxy", environment.TRUST_PROXY_HOPS);
  app.use(requestContext);
  app.use(
    pinoHttp({
      enabled: environment.NODE_ENV !== "test",
      level: environment.LOG_LEVEL,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers['set-cookie']",
        ],
        remove: true,
      },
    })
  );
  app.use(helmet());
  app.use(allowBrowserOrigins(environment.CORS_ALLOWED_ORIGINS));
  app.use(express.json({ limit: "1mb" }));
  app.use(
    rateLimit({
      limit: 120,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      skip: () => environment.NODE_ENV === "test",
      windowMs: 60_000,
    })
  );

  app.use("/health", createHealthRouter(dependencies.databaseHealthCheck));
  app.use("/api/v1/status", statusRouter);
  if (dependencies.authService) {
    if (dependencies.adminInsights) app.use("/api/v1/admin/insights", createAdminInsightsRouter(dependencies.authService, dependencies.adminInsights));
    if (dependencies.learnerProgress) app.use("/api/v1/learner/progress", createLearnerProgressRouter(dependencies.authService, dependencies.learnerProgress));
    app.use("/api/v1/admin/ai", createAiRouter(dependencies.authService, dependencies.generator ?? new OpenAIGenerator(environment)));
    if (dependencies.content) app.use("/api/v1", createContentRouter(dependencies.authService, dependencies.content));
    app.use("/api/v1/auth", createAuthRouter(dependencies.authService));
    app.use("/api/v1/admin/status", createAdminStatusRouter(dependencies.authService));
    app.use(
      "/api/v1/admin/monitoring",
      createMonitoringRouter(
        dependencies.authService,
        environment,
        dependencies.quizzes,
        dependencies.databaseHealthCheck
      )
    );
    if (dependencies.quizzes) app.use("/api/v1", createQuizRouter(dependencies.quizzes, dependencies.authService));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
