import type { Environment } from "../src/config/environment.js";

export const testEnvironment: Environment = {
  OPENAI_MODEL: "gpt-6.1-sol",
  AI_TIMEOUT_MS: 60000,
  CORS_ALLOWED_ORIGINS: [],
  ACCESS_TOKEN_TTL_MINUTES: 15,
  ADMIN_BOOTSTRAP_DISPLAY_NAME: "BatiBot Admin",
  DATABASE_SSL: false,
  JWT_ACCESS_SECRET: "test-access-secret-that-is-at-least-32-characters",
  JWT_AUDIENCE: "batibot-mobile-test",
  JWT_ISSUER: "batibot-backend-test",
  JWT_REFRESH_SECRET: "test-refresh-secret-that-is-at-least-32-characters",
  LOG_LEVEL: "silent",
  NODE_ENV: "test",
  PORT: 3_000,
  TRUST_PROXY_HOPS: 0,
  REFRESH_TOKEN_TTL_DAYS: 14,
};
