import { toErrorResponse } from "@/lib/errors";
import { conversationIdSchema } from "@/lib/validation";
import {
  deleteConversation,
  getConversationWithMessages,
} from "@/services/chat-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    return Response.json(
      await getConversationWithMessages(conversationIdSchema.parse(id)),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await deleteConversation(conversationIdSchema.parse(id));
    return new Response(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
