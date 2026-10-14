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
import { statusRouter } from "./routes/status.js";

export interface ApplicationDependencies {
  authService?: AuthService;
  databaseHealthCheck?: () => Promise<void>;
}

export function createApp(
  environment: Environment,
  dependencies: ApplicationDependencies = {}
) {
  const app = express();

  app.disable("x-powered-by");
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
  app.use(express.json({ limit: "256kb" }));
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
    app.use("/api/v1/auth", createAuthRouter(dependencies.authService));
    app.use("/api/v1/admin/status", createAdminStatusRouter(dependencies.authService));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
