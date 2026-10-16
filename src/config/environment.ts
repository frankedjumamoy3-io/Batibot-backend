import { z } from "zod";

const environmentSchema = z.object({
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().max(60).default(15),
  ADMIN_BOOTSTRAP_DISPLAY_NAME: z.string().trim().min(1).max(100).default("BatiBot Admin"),
  ADMIN_BOOTSTRAP_EMAIL: optionalNonEmptyString(),
  ADMIN_BOOTSTRAP_PASSWORD_HASH: optionalNonEmptyString(),
  DATABASE_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  DATABASE_URL: optionalNonEmptyString(),
  JWT_ACCESS_SECRET: optionalNonEmptyString(),
  JWT_AUDIENCE: z.string().trim().min(1).default("batibot-mobile"),
  JWT_ISSUER: z.string().trim().min(1).default("batibot-backend"),
  JWT_REFRESH_SECRET: optionalNonEmptyString(),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().max(65_535).default(3_000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(1).default(0),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(90).default(14),
});

export type Environment = z.infer<typeof environmentSchema>;

export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  return environmentSchema.parse(source);
}

function optionalNonEmptyString() {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().min(1).optional()
  );
}

export interface ServiceConfiguration {
  accessTokenSecret: string;
  databaseUrl: string;
  refreshTokenSecret: string;
}

export function requireServiceConfiguration(environment: Environment): ServiceConfiguration {
  const databaseUrl = environment.DATABASE_URL;
  const accessTokenSecret = environment.JWT_ACCESS_SECRET;
  const refreshTokenSecret = environment.JWT_REFRESH_SECRET;
  const missing: string[] = [];
  if (!databaseUrl) {
    missing.push("DATABASE_URL");
  }
  if (!accessTokenSecret || accessTokenSecret.length < 32) {
    missing.push("JWT_ACCESS_SECRET (minimum 32 characters)");
  }
  if (!refreshTokenSecret || refreshTokenSecret.length < 32) {
    missing.push("JWT_REFRESH_SECRET (minimum 32 characters)");
  }

  if (missing.length > 0 || !databaseUrl || !accessTokenSecret || !refreshTokenSecret) {
    throw new Error(`Missing or invalid service configuration: ${missing.join(", ")}`);
  }

  return {
    accessTokenSecret,
    databaseUrl,
    refreshTokenSecret,
  };
}
