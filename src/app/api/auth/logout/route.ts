import { endSession } from "@/auth/service";
import { toErrorResponse } from "@/lib/errors";

export async function POST() {
  try {
    await endSession();
    return new Response(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
