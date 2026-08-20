import { anthropic } from "@ai-sdk/anthropic";
import type { AnthropicProviderOptions } from "@ai-sdk/anthropic";

/** Anthropic's most capable generally available model. */
export const MODEL_ID = "claude-opus-5";

export const model = anthropic(MODEL_ID);

/**
 * Upper bound on model calls per request. Every tool result triggers another
 * call, so this is what stops a loop from running away.
 */
export const MAX_STEPS = 10;

export const SYSTEM_PROMPT = [
  "You are a research assistant that works by using tools.",
  "",
  "- Call `searchKnowledgeBase` before answering questions about agent design, tools, tracing or evaluation, and ground your answer in what it returns.",
  "- Call `calculate` for arithmetic. Do not compute results yourself.",
  "- Call `getCurrentTime` before answering anything that depends on the current date or time.",
  "- You may call several tools in one turn, and call more after seeing results.",
  "- Cite the document titles you used. If the tools do not cover something, say so instead of guessing.",
].join("\n");

export const providerOptions = {
  anthropic: {
    // Adaptive thinking lets the model decide how much to reason per step;
    // `summarized` streams a readable summary to the client.
    thinking: { type: "adaptive", display: "summarized" },
    effort: "high",
  } satisfies AnthropicProviderOptions,
};
