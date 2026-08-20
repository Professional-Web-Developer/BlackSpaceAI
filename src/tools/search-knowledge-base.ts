import { tool } from "ai";
import { z } from "zod";

import { documents } from "./knowledge-base-data";

/**
 * Keyword retrieval over a small in-repo document set. It exists as a worked
 * example of a retrieval tool with no external dependency - swap the backing
 * store for a real vector database when you outgrow it.
 */
export const searchKnowledgeBase = tool({
  description:
    "Search the project's notes on building agentic applications. Use this before answering questions about agent design, tools, tracing or evaluation.",
  inputSchema: z.object({
    query: z.string().describe("Keywords to search for"),
    limit: z.number().int().min(1).max(5).default(3),
  }),
  execute: async ({ query, limit }) => {
    const terms = query
      .toLowerCase()
      .split(/\W+/)
      .filter((term) => term.length > 2);

    const matches = documents
      .map((document) => {
        const haystack = `${document.title} ${document.content}`.toLowerCase();
        const score = terms.reduce(
          (total, term) => total + (haystack.includes(term) ? 1 : 0),
          0,
        );
        return { document, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return {
      query,
      results: matches.map(({ document, score }) => ({
        id: document.id,
        title: document.title,
        content: document.content,
        score,
      })),
    };
  },
});
