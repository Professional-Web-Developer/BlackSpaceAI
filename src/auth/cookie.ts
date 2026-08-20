/**
 * Cookie name and attributes, deliberately in a module with no imports.
 *
 * `middleware.ts` runs on the edge runtime, where `node:crypto` and the
 * database driver cannot load. Importing the cookie name from `session.ts`
 * pulled both into the edge bundle and failed the build, so the constant lives
 * here and both sides import it.
 */
export const SESSION_COOKIE = "blackspace_session";

export const cookieOptions = (expiresAt: Date) =>
  ({
    httpOnly: true,
    sameSite: "lax" as const,
    // Secure in production; a local http:// dev server would drop the cookie.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  }) satisfies Record<string, unknown>;
