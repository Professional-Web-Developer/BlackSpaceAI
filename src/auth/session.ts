import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, lt } from "drizzle-orm";

import { getDatabase, schema } from "@/db/client";

export { SESSION_COOKIE, cookieOptions } from "./cookie";

/** Sessions last a fortnight, and are extended when used. */
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** Only rewrite `lastUsedAt` when it is meaningfully stale. */
const TOUCH_AFTER_MS = 60 * 60 * 1000;

export type SessionUser = {
  id: string;
  email: string;
  role: "admin" | "member";
};

/**
 * Only the hash of a session token is stored. The plaintext lives solely in
 * the user's cookie, so a leaked database does not hand over live sessions.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await getDatabase().insert(schema.sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
  });

  return { token, expiresAt };
}

/** Resolves a cookie value to a user, or null when it is invalid or expired. */
export async function resolveSession(
  token: string | undefined,
): Promise<SessionUser | null> {
  if (!token) return null;

  const db = getDatabase();
  const tokenHash = hashToken(token);

  const [row] = await db
    .select({
      sessionId: schema.sessions.id,
      lastUsedAt: schema.sessions.lastUsedAt,
      id: schema.users.id,
      email: schema.users.email,
      role: schema.users.role,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(
      and(
        eq(schema.sessions.tokenHash, tokenHash),
        gt(schema.sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!row) return null;

  // Sliding expiry, written at most hourly so an active session does not cause
  // a database write on every request.
  if (Date.now() - row.lastUsedAt.getTime() > TOUCH_AFTER_MS) {
    await db
      .update(schema.sessions)
      .set({
        lastUsedAt: new Date(),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      })
      .where(eq(schema.sessions.id, row.sessionId));
  }

  return { id: row.id, email: row.email, role: row.role };
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await getDatabase()
    .delete(schema.sessions)
    .where(eq(schema.sessions.tokenHash, hashToken(token)));
}

/** Signing out everywhere - used after a password change. */
export async function destroyAllSessions(userId: string): Promise<void> {
  await getDatabase()
    .delete(schema.sessions)
    .where(eq(schema.sessions.userId, userId));
}

/** Housekeeping for expired rows; safe to call opportunistically. */
export async function purgeExpiredSessions(): Promise<void> {
  await getDatabase()
    .delete(schema.sessions)
    .where(lt(schema.sessions.expiresAt, new Date()));
}

