import { createApp } from "./app.js";
import { loadEnvironment } from "./config/environment.js";

const environment = loadEnvironment();
const app = createApp(environment);

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
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
