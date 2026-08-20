import type { ToolName } from "@/tools/registry";

/** Anthropic effort levels, lowest to highest. */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * A profile as it is written in `profiles.ts`. Everything that makes an agent
 * behave differently lives here - the loop itself is generic and reads this.
 *
 * To build an agent for a new purpose, add a profile. No route, service or
 * component changes.
 */
export type AgentProfileInput = {
  /** Stable identifier; stored on conversations, so do not rename casually. */
  id: string;
  name: string;
  /** One line, shown in the agent picker. */
  description: string;
  /** The agent's instructions. */
  systemPrompt: string;
  /** Which registered tools this agent may call. */
  tools: readonly ToolName[];
  /**
   * Agent Skills to make available, by folder name under `skills/`. Claude
   * loads a skill on demand during a turn, so unlike the system prompt they
   * cost nothing until they are actually used.
   *
   * Skills execute inside the code execution sandbox, so a profile that lists
   * them must also include the `code_execution` tool.
   */
  skills?: readonly string[];
  /**
   * Anthropic model id. Omit it to follow the `ANTHROPIC_MODEL` environment
   * variable, which is what almost every agent should do; set it only to pin
   * one agent to a specific model regardless of the environment.
   */
  model?: string;
  /** Upper bound on model calls per turn - what stops a runaway loop. */
  maxSteps: number;
  /** Higher effort means deeper reasoning and more tokens. */
  effort: Effort;
  /**
   * Adaptive thinking lets the model decide how much to reason per step.
   * Turn it off only for simple, latency-sensitive agents.
   */
  thinking: boolean;
  /**
   * Prompt caching. On by default, and worth leaving on: an agent loop
   * re-sends its whole history every step, so from the second step onwards
   * most input tokens are cache reads at about a tenth of the price.
   *
   * Anthropic will not cache a prefix below roughly 1024 tokens, so a very
   * small agent simply gets no benefit rather than an error.
   */
  caching?: boolean;
  /**
   * Server-side compaction for conversations that outgrow the context window.
   * Present means enabled. Anthropic summarises the earlier turns and returns
   * a compaction block that is stored with the thread and sent back on later
   * turns in place of what it replaced.
   *
   * Only worth it on agents whose threads get long; it costs a summarisation
   * pass when it triggers.
   */
  compaction?: {
    /** Input-token threshold that triggers compaction. */
    triggerTokens?: number;
    /** Steer what the summary keeps. */
    instructions?: string;
  };
};

/**
 * A profile after the registry has resolved it. `model` is always present
 * here, so nothing downstream has to know where the value came from.
 */
export type AgentProfile = Omit<AgentProfileInput, "model"> & {
  model: string;
};

/** The shape the client needs to render a picker. No prompt text. */
export type AgentSummary = {
  id: string;
  name: string;
  description: string;
  tools: string[];
  usesNetwork: boolean;
};
