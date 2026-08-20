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
   * Model every agent uses unless its profile pins one explicitly. Kept as a
   * plain string rather than an enum so a newly released model can be rolled
   * out by changing an environment variable, with no code change.
   */
  ANTHROPIC_MODEL: z.string().min(1).default("claude-opus-5"),

  /**
   * Set to "true" to skip the startup check that configured models exist.
   * Useful offline, and in CI where no API key is available.
   */
  SKIP_MODEL_VALIDATION: z
    .string()
    .optional()
    // Explicit rather than `z.coerce.boolean()`, which treats the string
    // "false" as true because it is non-empty.
    .transform((value) => value === "true"),

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
