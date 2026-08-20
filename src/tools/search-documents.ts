import { tool } from "ai";
import { z } from "zod";

import { logger } from "@/lib/logger";
import { retrieveChunks } from "@/rag/store";

/**
 * Retrieval over the ingested knowledge base.
 *
 * The description tells the model what to do when nothing comes back, because
 * an empty result is the case that produces confident invention otherwise.
 */
export const searchDocuments = tool({
  description:
    "Search the knowledge base of ingested documents for passages relevant to a question. Use this before answering anything that the knowledge base might cover. If it returns no results, say the knowledge base does not cover the topic rather than answering from memory.",
  inputSchema: z.object({
    query: z
      .string()
      .min(2)
      .describe(
        "What to look for, phrased as the question or statement you want passages about",
      ),
    limit: z.number().int().min(1).max(10).default(6),
  }),
  execute: async ({ query, limit }) => {
    try {
      const results = await retrieveChunks({ query, limit });

      return {
        query,
        matchCount: results.length,
        results: results.map((chunk) => ({
          title: chunk.documentTitle,
          source: chunk.source,
          passage: chunk.content,
          similarity: Number(chunk.similarity.toFixed(3)),
        })),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Retrieval failed";
      logger.error("Document retrieval failed", { query, error: message });

      // Returned rather than thrown: the model can tell the user retrieval is
      // unavailable instead of the whole turn failing.
      return { query, matchCount: 0, results: [], error: message };
    }
  },
});
