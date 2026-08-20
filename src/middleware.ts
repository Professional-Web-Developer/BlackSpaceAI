import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/auth/cookie";

/**
 * A cheap gate only: middleware runs on the edge runtime and cannot reach the
 * database, so it checks for the presence of a session cookie and nothing
 * more. A forged or expired cookie gets past this and is rejected properly by
 * `requireUser()` in the route or page, which verifies against the session
 * table. This exists to steer signed-out visitors, not to authorise.
 */
export function middleware(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  // An API client cannot follow a redirect to an HTML sign-in page, so those
  // get the status they can act on. Only page requests are redirected.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Sign in to continue", code: "unauthorized" },
      { status: 401 },
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the auth endpoints, the login page and static assets.
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
