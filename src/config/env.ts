import { z } from "zod";

/**
 * Environment is parsed once, at module load, so a misconfigured deployment
 * fails immediately with a readable message instead of throwing deep inside a
 * request handler.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  /**
   * Postgres connection string. When absent the app falls back to the
   * in-memory repository so a fresh clone runs without any infrastructure.
   */
  DATABASE_URL: z.string().url().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),

  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASE_URL: z.string().url().default("https://cloud.langfuse.com"),
  LANGFUSE_TRACING_ENVIRONMENT: z.string().default("development"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;

/** Persistence is backed by Postgres only when a connection string is set. */
export const isDatabaseEnabled = Boolean(env.DATABASE_URL);

/** Traces are exported only when both Langfuse keys are set. */
export const isTracingEnabled = Boolean(
  env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY,
);
