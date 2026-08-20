import Anthropic from "@anthropic-ai/sdk";

import { env } from "@/config/env";

import { logger } from "./logger";

/**
 * Startup check that every model an agent is configured to use actually
 * exists, so a typo in `ANTHROPIC_MODEL` is caught at boot rather than on a
 * user's first message.
 *
 * The client reads `ANTHROPIC_BASE_URL` from the environment exactly as the
 * chat provider does, so a proxied deployment checks against the same
 * endpoint it will later call.
 */

export type ModelCheck =
  /** The model exists. */
  | { status: "ok"; model: string; displayName: string; contextWindow: number | null }
  /** The API is certain this model does not exist. This fails startup. */
  | { status: "unknown"; model: string }
  /** Could not reach a verdict. Logged, but never fatal. */
  | { status: "unverified"; model: string; reason: string };

/** Startup must not hang on a slow or unreachable API. */
const TIMEOUT_MS = 10_000;

async function checkModel(
  client: Anthropic,
  model: string,
): Promise<ModelCheck> {
  try {
    const info = await client.models.retrieve(model);
    return {
      status: "ok",
      model,
      displayName: info.display_name,
      contextWindow: info.max_input_tokens,
    };
  } catch (error) {
    // A 404 is the one answer that definitively means "this id is wrong".
    if (error instanceof Anthropic.NotFoundError) {
      return { status: "unknown", model };
    }

    // Everything else - a bad key, a rate limit, an outage, no network - says
    // nothing about whether the model id is valid. Refusing to boot on those
    // would make an Anthropic blip an outage here too, so they only warn. A
    // genuinely broken key still surfaces on the first chat request.
    const reason =
      error instanceof Anthropic.APIError
        ? `${error.constructor.name}${error.status ? ` (${error.status})` : ""}`
        : error instanceof Error
          ? error.message
          : String(error);

    return { status: "unverified", model, reason };
  }
}

/**
 * Checks each distinct model once. Returns the results; deciding what is
 * fatal is the caller's job.
 */
export async function verifyModels(models: string[]): Promise<ModelCheck[]> {
  const distinct = [...new Set(models)];
  if (distinct.length === 0) return [];

  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    timeout: TIMEOUT_MS,
    // One retry: a single blip should not stall startup, and the result is
    // advisory anyway.
    maxRetries: 1,
  });

  return Promise.all(distinct.map((model) => checkModel(client, model)));
}

/** Why a run of the check was skipped, or `undefined` when it should run. */
export function skipReason(): string | undefined {
  if (env.SKIP_MODEL_VALIDATION) {
    return "SKIP_MODEL_VALIDATION is set";
  }
  if (!env.ANTHROPIC_API_KEY) {
    return "ANTHROPIC_API_KEY is not set";
  }
  // `next build` imports the instrumentation hook while collecting page data.
  // Builds should not depend on the network or on a live API key.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return "running a production build";
  }
  return undefined;
}

/**
 * Runs the check and throws when a model is known not to exist.
 *
 * Called from instrumentation, so an unknown model stops the server from
 * coming up at all instead of failing every chat request at runtime.
 */
export async function verifyConfiguredModels(models: string[]): Promise<void> {
  const skipped = skipReason();
  if (skipped) {
    logger.info(`Model validation skipped - ${skipped}`);
    return;
  }

  const results = await verifyModels(models);

  const unknown = results.filter((result) => result.status === "unknown");
  if (unknown.length > 0) {
    const names = unknown.map((result) => result.model).join(", ");
    throw new Error(
      `Unknown model id(s): ${names}. Check ANTHROPIC_MODEL and any model pinned on an agent profile against the models your account can use.`,
    );
  }

  for (const result of results) {
    if (result.status === "ok") {
      logger.info("Model verified", {
        model: result.model,
        displayName: result.displayName,
        contextWindow: result.contextWindow,
      });
    } else if (result.status === "unverified") {
      logger.warn(
        "Could not verify model - continuing, the id may still be wrong",
        { model: result.model, reason: result.reason },
      );
    }
  }
}
