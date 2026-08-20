import { anthropic } from "@ai-sdk/anthropic";
import type { ToolSet } from "ai";

import { calculate } from "./calculate";
import { currentTime } from "./current-time";
import { searchDocuments } from "./search-documents";
import { searchKnowledgeBase } from "./search-knowledge-base";

/**
 * Every tool the system knows about, keyed by the name the model sees.
 *
 * Two kinds live here:
 *
 * - **Local tools** run in this process. Their `execute` function is ours, so
 *   they can reach a database, an internal API, anything.
 * - **Server-side tools** are executed by Anthropic. We only declare them;
 *   there is no `execute` to write and no extra credentials to hold. The keys
 *   must match the names the API uses (`web_search`, `web_fetch`,
 *   `code_execution`).
 *
 * Adding a capability means adding one entry here and listing its name on an
 * agent profile. Nothing else changes.
 */
export const toolRegistry = {
  calculate,
  current_time: currentTime,
  search_knowledge_base: searchKnowledgeBase,
  search_documents: searchDocuments,

  web_search: anthropic.tools.webSearch_20260209({ maxUses: 8 }),
  web_fetch: anthropic.tools.webFetch_20260209({ maxUses: 8 }),
  code_execution: anthropic.tools.codeExecution_20260120(),
} as const satisfies ToolSet;

export type ToolName = keyof typeof toolRegistry;

export const ALL_TOOL_NAMES = Object.keys(toolRegistry) as ToolName[];

/**
 * Tools that reach the public internet. Surfaced in the UI so it is obvious
 * which agents can leave the building.
 */
export const NETWORK_TOOL_NAMES: ToolName[] = ["web_search", "web_fetch"];

/**
 * `web_search_20260209` and `web_fetch_20260209` filter results by running
 * code in Anthropic's sandbox already. Declaring `code_execution` alongside
 * them gives the model two execution environments and it starts confusing
 * them, so the combination is rejected when profiles are loaded.
 */
export const INCOMPATIBLE_TOOL_PAIRS: [ToolName, ToolName][] = [
  ["web_search", "code_execution"],
  ["web_fetch", "code_execution"],
];

/** Narrows the registry to the tools one agent is allowed to use. */
export function resolveTools(names: readonly ToolName[]): ToolSet {
  return Object.fromEntries(
    names.map((name) => [name, toolRegistry[name]]),
  ) satisfies ToolSet;
}

/** Human-readable labels for the UI. */
export const TOOL_LABELS: Record<ToolName, string> = {
  calculate: "Arithmetic",
  current_time: "Current time",
  search_knowledge_base: "Built-in notes",
  search_documents: "Knowledge base (RAG)",
  web_search: "Web search",
  web_fetch: "Web fetch",
  code_execution: "Code execution",
};
