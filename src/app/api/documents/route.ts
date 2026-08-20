import { requireAdmin, requireUser } from "@/auth/service";
import { isDatabaseEnabled } from "@/config/env";
import { ConfigurationError, toErrorResponse } from "@/lib/errors";
import { ingestDocumentSchema } from "@/lib/validation";
import { isRagEnabled } from "@/rag/embeddings";
import { ingestDocument, listDocuments } from "@/rag/store";

/** Ingestion embeds every chunk, which takes a while for a large document. */
export const maxDuration = 300;

function assertRagAvailable(): void {
  if (!isDatabaseEnabled) {
    throw new ConfigurationError(
      "Retrieval needs a database. Set DATABASE_URL and run `npm run db:migrate`.",
    );
  }
  if (!isRagEnabled()) {
    throw new ConfigurationError(
      "Retrieval needs an embedding provider. Set VOYAGE_API_KEY (or switch EMBEDDING_PROVIDER to openai and set OPENAI_API_KEY).",
    );
  }
}

export async function GET() {
  try {
    // The knowledge base is shared, so any signed-in user may read it.
    await requireUser();
    assertRagAvailable();
    return Response.json({ documents: await listDocuments() });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = ingestDocumentSchema.parse(await request.json());
    // Ingestion changes what every user's agent will say, so it is restricted.
    const admin = await requireAdmin();
    assertRagAvailable();

    const result = await ingestDocument({ ...input, createdBy: admin.id });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
