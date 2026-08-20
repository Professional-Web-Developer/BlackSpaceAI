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
