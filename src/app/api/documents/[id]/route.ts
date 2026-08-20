import { NotFoundError, toErrorResponse } from "@/lib/errors";
import { documentIdSchema } from "@/lib/validation";
import { deleteDocument } from "@/rag/store";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    // Chunks are removed with the document by ON DELETE CASCADE.
    const deleted = await deleteDocument(documentIdSchema.parse(id));
    if (!deleted) throw new NotFoundError("Document");

    return new Response(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
