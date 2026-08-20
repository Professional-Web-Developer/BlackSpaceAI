import { toErrorResponse } from "@/lib/errors";
import { listConversationsQuerySchema } from "@/lib/validation";
import { listConversations } from "@/services/chat-service";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const { limit } = listConversationsQuerySchema.parse(
      Object.fromEntries(searchParams),
    );

    return Response.json({ conversations: await listConversations(limit) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
