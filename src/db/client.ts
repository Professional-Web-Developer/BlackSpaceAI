import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "@/config/env";
import { ConfigurationError } from "@/lib/errors";

import * as schema from "./schema";

export type Database = ReturnType<typeof createDatabase>;

function createDatabase(connectionString: string) {
  const sql = postgres(connectionString, {
    max: env.DATABASE_POOL_MAX,
    // Serverless platforms open many short-lived connections; prepared
    // statements are not reusable across them and break connection poolers.
    prepare: false,
  });

  return drizzle(sql, { schema });
}

/**
 * Cached on `globalThis` so Next.js hot reloads in development reuse one pool
 * instead of exhausting the database with a new pool per reload.
 */
const globalForDb = globalThis as unknown as { __db?: Database };

export function getDatabase(): Database {
  if (!env.DATABASE_URL) {
    throw new ConfigurationError(
      "DATABASE_URL is not set, so the Postgres repository is unavailable.",
    );
  }

  globalForDb.__db ??= createDatabase(env.DATABASE_URL);
  return globalForDb.__db;
}

export { schema };
