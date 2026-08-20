import { requireAdmin, requireUser } from "@/auth/service";
import { usageForAllUsers, usageForUser } from "@/billing/usage";
import { toErrorResponse } from "@/lib/errors";

/**
 * The caller's spend this period. `?scope=all` gives every user's, for admins,
 * so they can see who is consuming the budget before raising a limit.
 */
export async function GET(request: Request) {
  try {
    const scope = new URL(request.url).searchParams.get("scope");

    if (scope === "all") {
      await requireAdmin();
      return Response.json({ users: await usageForAllUsers() });
    }

    const user = await requireUser();
    return Response.json({ usage: await usageForUser(user.id) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
