import { requireUser } from "@/auth/service";
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
    const user = await requireUser();

    return Response.json(
      await getConversationWithMessages(
        conversationIdSchema.parse(id),
        user.id,
      ),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = await requireUser();

    await deleteConversation(conversationIdSchema.parse(id), user.id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
