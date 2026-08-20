import { checkRateLimit, clientKey } from "@/auth/rate-limit";
import { register, startSession } from "@/auth/service";
import { AppError, toErrorResponse } from "@/lib/errors";
import { credentialsSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const input = credentialsSchema.parse(await request.json());

    const limit = checkRateLimit(clientKey(request, "register"));
    if (!limit.allowed) {
      throw new AppError(
        `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
        429,
        "rate_limited",
      );
    }

    const user = await register(input);
    await startSession(user.id);

    return Response.json({ user }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
