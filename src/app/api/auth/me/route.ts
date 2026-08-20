import { getCurrentUser } from "@/auth/service";
import { toErrorResponse } from "@/lib/errors";

export async function GET() {
  try {
    return Response.json({ user: await getCurrentUser() });
  } catch (error) {
    return toErrorResponse(error);
  }
}
