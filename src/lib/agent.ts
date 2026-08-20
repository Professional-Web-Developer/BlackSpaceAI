import { anthropic } from "@ai-sdk/anthropic";
import type { AnthropicProviderOptions } from "@ai-sdk/anthropic";

import type { AgentProfile } from "@/agents/registry";

/** Model instance for a profile. Cached, since profiles are a fixed set. */
const modelCache = new Map<string, ReturnType<typeof anthropic>>();

export function getModel(profile: AgentProfile) {
  const cached = modelCache.get(profile.model);
  if (cached) return cached;

  const model = anthropic(profile.model);
  modelCache.set(profile.model, model);
  return model;
}

/**
 * Provider settings derived from a profile.
 *
 * Adaptive thinking lets the model decide how much to reason per step rather
 * than spending a fixed token budget; `summarized` is what makes the reasoning
 * visible in the UI. Effort controls overall depth and token spend.
 */
export function getProviderOptions(profile: AgentProfile) {
  return {
    anthropic: {
      thinking: profile.thinking
        ? { type: "adaptive", display: "summarized" }
        : { type: "disabled" },
      effort: profile.effort,
    } satisfies AnthropicProviderOptions,
  };
}
