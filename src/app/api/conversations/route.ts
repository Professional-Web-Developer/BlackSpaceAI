import { requireUser } from "@/auth/service";
import { toErrorResponse } from "@/lib/errors";
import { listConversationsQuerySchema } from "@/lib/validation";
import { listConversations } from "@/services/chat-service";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const { limit } = listConversationsQuerySchema.parse(
      Object.fromEntries(searchParams),
    );
    const user = await requireUser();

    return Response.json({
      conversations: await listConversations(user.id, limit),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
