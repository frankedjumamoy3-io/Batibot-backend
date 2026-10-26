import "dotenv/config";

import { createApp } from "./app.js";
import { AuthService } from "./auth/auth-service.js";
import { UserRepository } from "./auth/user-repository.js";
import { loadEnvironment, requireServiceConfiguration } from "./config/environment.js";
import { checkDatabase, createDatabasePool } from "./database/pool.js";
import { QuizRepository } from "./quizzes/repository.js";
import { ContentRepository } from "./content/repository.js";
import { LearnerProgressRepository } from "./learners/progress-repository.js";

const environment = loadEnvironment();
const configuration = requireServiceConfiguration(environment);
const pool = createDatabasePool(configuration.databaseUrl, environment.DATABASE_SSL);
const users = new UserRepository(pool);
const authService = new AuthService(pool, users, environment);
const app = createApp(environment, {
  learnerProgress: new LearnerProgressRepository(pool),
  content: new ContentRepository(pool),
  quizzes: new QuizRepository(pool),
  authService,
  databaseHealthCheck: () => checkDatabase(pool),
});

const server = app.listen(environment.PORT, "0.0.0.0", () => {
  console.log(
    JSON.stringify({
      event: "server.started",
      port: environment.PORT,
      service: "batibot-backend",
    })
  );
});

function shutdown(signal: string) {
  console.log(JSON.stringify({ event: "server.stopping", signal }));
  server.close((error) => {
    if (error) {
      console.error(JSON.stringify({ event: "server.stop_failed" }));
      process.exitCode = 1;
      return;
    }

    void pool.end();
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
