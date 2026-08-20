import { cosineDistance, desc, eq, gt, sql } from "drizzle-orm";

import { env } from "@/config/env";
import { getDatabase, schema } from "@/db/client";
import { logger } from "@/lib/logger";

import { chunkText } from "./chunking";
import { embedDocuments, embedQuery } from "./embeddings";

export type DocumentSummary = {
  id: string;
  title: string;
  source: string | null;
  chunkCount: number;
  createdAt: Date;
};

export type RetrievedChunk = {
  documentId: string;
  documentTitle: string;
  source: string | null;
  chunkIndex: number;
  content: string;
  /** 0-1, higher is closer. Cosine similarity, not distance. */
  similarity: number;
};

/**
 * Chunks, embeds and stores a document in one transaction, so a failure part
 * way through the embedding batch never leaves a document with some of its
 * passages indexed.
 */
export async function ingestDocument(input: {
  title: string;
  content: string;
  source?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ documentId: string; chunks: number }> {
  const chunks = chunkText(input.content);
  if (chunks.length === 0) {
    throw new Error("Document produced no chunks - is it empty?");
  }

  // Embedding happens before the transaction opens: it is a network call that
  // can take seconds, and holding a database transaction open across it would
  // pin a connection for no reason.
  const embeddings = await embedDocuments(chunks.map((chunk) => chunk.content));

  const db = getDatabase();

  return db.transaction(async (tx) => {
    const [document] = await tx
      .insert(schema.documents)
      .values({
        title: input.title,
        source: input.source,
        content: input.content,
        metadata: input.metadata,
      })
      .returning({ id: schema.documents.id });

    await tx.insert(schema.documentChunks).values(
      chunks.map((chunk, position) => ({
        documentId: document.id,
        chunkIndex: chunk.index,
        content: chunk.content,
        embedding: embeddings[position],
      })),
    );

    logger.info("Document ingested", {
      documentId: document.id,
      title: input.title,
      chunks: chunks.length,
    });

    return { documentId: document.id, chunks: chunks.length };
  });
}

/**
 * Vector search over stored passages.
 *
 * The similarity floor matters more than it looks: without one, a query about
 * something the knowledge base does not cover still returns the k least-bad
 * chunks, and the model treats them as evidence. Returning nothing is the
 * honest answer, and the tool's description tells the model to say so.
 *
 * The floor is not a universal constant - it depends on how the embedding
 * model distributes similarity - so it comes from `RAG_MIN_SIMILARITY` and
 * needs calibrating whenever the embedding model changes.
 */
export async function retrieveChunks(input: {
  query: string;
  limit?: number;
  minSimilarity?: number;
}): Promise<RetrievedChunk[]> {
  const {
    query,
    limit = env.RAG_MAX_RESULTS,
    minSimilarity = env.RAG_MIN_SIMILARITY,
  } = input;

  const embedding = await embedQuery(query);
  const db = getDatabase();

  const similarity = sql<number>`1 - (${cosineDistance(
    schema.documentChunks.embedding,
    embedding,
  )})`;

  return db
    .select({
      documentId: schema.documentChunks.documentId,
      documentTitle: schema.documents.title,
      source: schema.documents.source,
      chunkIndex: schema.documentChunks.chunkIndex,
      content: schema.documentChunks.content,
      similarity,
    })
    .from(schema.documentChunks)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.documentChunks.documentId),
    )
    .where(gt(similarity, minSimilarity))
    .orderBy((table) => desc(table.similarity))
    .limit(limit);
}

export async function listDocuments(limit = 100): Promise<DocumentSummary[]> {
  const db = getDatabase();

  return db
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      source: schema.documents.source,
      createdAt: schema.documents.createdAt,
      chunkCount: sql<number>`count(${schema.documentChunks.id})::int`,
    })
    .from(schema.documents)
    .leftJoin(
      schema.documentChunks,
      eq(schema.documentChunks.documentId, schema.documents.id),
    )
    .groupBy(schema.documents.id)
    .orderBy(desc(schema.documents.createdAt))
    .limit(limit);
}

export async function deleteDocument(id: string): Promise<boolean> {
  const db = getDatabase();

  // Chunks go with the document via ON DELETE CASCADE.
  const deleted = await db
    .delete(schema.documents)
    .where(eq(schema.documents.id, id))
    .returning({ id: schema.documents.id });

  return deleted.length > 0;
}
