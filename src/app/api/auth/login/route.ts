import {
  checkRateLimit,
  clearRateLimit,
  clientKey,
} from "@/auth/rate-limit";
import { login, startSession } from "@/auth/service";
import { AppError, toErrorResponse } from "@/lib/errors";
import { credentialsSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const input = credentialsSchema.parse(await request.json());

    const key = clientKey(request, "login");
    const limit = checkRateLimit(key);
    if (!limit.allowed) {
      throw new AppError(
        `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
        429,
        "rate_limited",
      );
    }

    const user = await login(input);
    await startSession(user.id);
    // A successful sign-in clears the counter so a legitimate user who
    // mistyped a few times is not locked out afterwards.
    clearRateLimit(key);

    return Response.json({ user });
  } catch (error) {
    return toErrorResponse(error);
  }
}
