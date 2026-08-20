import { cookies } from "next/headers";
import { eq } from "drizzle-orm";

import { env } from "@/config/env";
import { getDatabase, schema } from "@/db/client";
import { AppError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";

import { fakeVerifyDelay, hashPassword, verifyPassword } from "./password";
import { SESSION_COOKIE, cookieOptions } from "./cookie";
import {
  createSession,
  destroySession,
  resolveSession,
  type SessionUser,
} from "./session";

export class UnauthorizedError extends AppError {
  constructor(message = "Sign in to continue") {
    super(message, 401, "unauthorized");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to this") {
    super(message, 403, "forbidden");
  }
}

/** Emails are normalised so lookups and the unique constraint agree. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Admins are named by environment rather than promoted in-app, so the first
 * person to register cannot make themselves one.
 */
function roleFor(email: string): "admin" | "member" {
  return env.ADMIN_EMAILS.includes(email) ? "admin" : "member";
}

export async function register(input: {
  email: string;
  password: string;
}): Promise<SessionUser> {
  const email = normaliseEmail(input.email);
  const db = getDatabase();

  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  if (existing) {
    // Deliberately the same message the login path gives, so registration
    // cannot be used to discover which addresses already have accounts.
    throw new ValidationError("Could not create that account");
  }

  const [user] = await db
    .insert(schema.users)
    .values({
      email,
      passwordHash: await hashPassword(input.password),
      role: roleFor(email),
    })
    .returning({
      id: schema.users.id,
      email: schema.users.email,
      role: schema.users.role,
    });

  logger.info("Account created", { userId: user.id, role: user.role });
  return user;
}

export async function login(input: {
  email: string;
  password: string;
}): Promise<SessionUser> {
  const email = normaliseEmail(input.email);

  const [user] = await getDatabase()
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  if (!user) {
    // Spend comparable time so response timing does not reveal whether the
    // address exists.
    await fakeVerifyDelay();
    throw new UnauthorizedError("Incorrect email or password");
  }

  if (!(await verifyPassword(input.password, user.passwordHash))) {
    throw new UnauthorizedError("Incorrect email or password");
  }

  await getDatabase()
    .update(schema.users)
    .set({ lastLoginAt: new Date() })
    .where(eq(schema.users.id, user.id));

  return { id: user.id, email: user.email, role: user.role };
}

/** Issues the session cookie for a signed-in user. */
export async function startSession(userId: string): Promise<void> {
  const { token, expiresAt } = await createSession(userId);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, cookieOptions(expiresAt));
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  await destroySession(token);
  store.delete(SESSION_COOKIE);
}

/** The signed-in user, or null. Safe to call anywhere on the server. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return resolveSession(store.get(SESSION_COOKIE)?.value);
}

/** The signed-in user, or throws a 401. Use in route handlers. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/** The signed-in admin, or throws. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") {
    throw new ForbiddenError("This action is restricted to administrators");
  }
  return user;
}
