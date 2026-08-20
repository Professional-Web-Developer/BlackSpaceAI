import { logger } from "@/lib/logger";

/**
 * Model prices in US dollars per million tokens.
 *
 * UPDATE THIS when Anthropic changes prices or you adopt a new model. It is a
 * local table because there is no pricing API to read at runtime; a stale
 * entry silently mis-bills, so it is worth reviewing when you change
 * ANTHROPIC_MODEL.
 *
 * Cache reads are billed at roughly a tenth of the input rate and cache writes
 * at roughly 1.25x, which matters here: an agent loop re-sends its history
 * every step, so most input tokens on a long turn are cache reads. Pricing
 * them at the full rate would overstate cost several times over.
 */
export type ModelPrice = {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
};

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-fable-5": { input: 10, output: 50 },
  "claude-mythos-5": { input: 10, output: 50 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

/** Costs are kept as integer nano-dollars, so no floating point drift. */
const NANOS_PER_USD = 1_000_000_000;

export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

/**
 * An unknown model is priced at the most expensive known tier rather than
 * zero. This is a spending limit: under-billing an unrecognised model would
 * let it run past the cap unnoticed, so the failure mode leans towards
 * over-charging and a loud warning.
 */
function priceFor(model: string): ModelPrice {
  const price = MODEL_PRICES[model];
  if (price) return price;

  const fallback = Object.values(MODEL_PRICES).reduce((worst, candidate) =>
    candidate.output > worst.output ? candidate : worst,
  );

  logger.warn(
    "No price for model - billing at the highest known rate. Add it to MODEL_PRICES.",
    { model, assumed: fallback },
  );

  return fallback;
}

/** Cost of one turn, in integer nano-dollars. */
export function costOfUsage(model: string, usage: TokenUsage): number {
  const price = priceFor(model);

  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  // `inputTokens` is the total, so the cached portions are subtracted out
  // before charging the remainder at the full rate.
  const uncachedInput = Math.max(
    0,
    (usage.inputTokens ?? 0) - cacheRead - cacheWrite,
  );

  const inputUsd =
    ((uncachedInput +
      cacheRead * CACHE_READ_MULTIPLIER +
      cacheWrite * CACHE_WRITE_MULTIPLIER) *
      price.input) /
    1_000_000;

  const outputUsd = ((usage.outputTokens ?? 0) * price.output) / 1_000_000;

  return Math.round((inputUsd + outputUsd) * NANOS_PER_USD);
}

export function nanosToUsd(nanos: number): number {
  return nanos / NANOS_PER_USD;
}

export function usdToNanos(usd: number): number {
  return Math.round(usd * NANOS_PER_USD);
}

/** Human-readable, with enough precision for the small numbers involved. */
export function formatUsd(nanos: number): string {
  const usd = nanosToUsd(nanos);
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
