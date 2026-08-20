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
   * Postgres connection string. Required in practice: the in-memory
   * repository below only covers conversations, while accounts and sessions
   * read the database directly, so sign-in fails without this. It stays
   * optional in the schema so tooling that never authenticates - the
   * repository verification script, for one - still runs.
   */
  DATABASE_URL: z.string().url().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),

  /**
   * Embeddings for retrieval. Anthropic does not provide an embedding model,
   * so this is the one pluggable provider. Retrieval is disabled entirely when
   * the chosen provider has no key, and the rest of the app is unaffected.
   */
  EMBEDDING_PROVIDER: z.enum(["voyage", "openai"]).default("voyage"),
  EMBEDDING_MODEL: z.string().min(1).default("voyage-3.5"),
  VOYAGE_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  /**
   * Overrides the embedding provider's endpoint. Needed for a gateway, a
   * self-hosted or Azure-style deployment, or a regional endpoint.
   */
  EMBEDDING_BASE_URL: z.string().url().optional(),
  /**
   * Similarity floor for retrieval, below which a passage is treated as "not
   * found" rather than returned as weak evidence.
   *
   * This MUST be calibrated for the embedding model in use - models differ
   * enormously in how they distribute cosine similarity, and a value that
   * filters noise for one will reject every real match for another. The
   * default suits voyage-3.5. See the README for how to tune it.
   */
  RAG_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.35),
  RAG_MAX_RESULTS: z.coerce.number().int().min(1).max(20).default(6),

  /**
   * Addresses that get the admin role when they register. Admins are the only
   * accounts that can ingest or delete knowledge base documents. Naming them
   * here rather than promoting in-app means the first person to sign up cannot
   * make themselves one.
   */
  /**
   * Monthly spend cap per user, in US dollars, for accounts without their own
   * override. Set to 0 to disable the limit entirely - spending is still
   * recorded, it is just never refused.
   */
  DEFAULT_MONTHLY_LIMIT_USD: z.coerce.number().min(0).default(20),

  ADMIN_EMAILS: z
    .string()
    .optional()
    .transform((value) =>
      (value ?? "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),

  /**
   * Attachment storage. Without a bucket the app falls back to sending small
   * files inline, so this is optional - but inline attachments are stored in
   * the message row, which is why the inline limits are low.
   */
  AWS_REGION: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(1).optional(),
  /** Omit both to use the SDK's default credential chain (IAM role, profile). */
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  /** For S3-compatible stores: Cloudflare R2, MinIO, or a local test server. */
  S3_ENDPOINT: z.string().url().optional(),
  /** Per-file ceiling for direct uploads, in megabytes. */
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(500).default(25),

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
