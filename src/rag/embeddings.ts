import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createVoyage } from "@ai-sdk/voyage";
import {
  embed,
  embedMany,
  type EmbeddingModel,
  type ProviderMetadata,
} from "ai";

import { env } from "@/config/env";
import { ConfigurationError } from "@/lib/errors";

import { EMBEDDING_DIMENSIONS } from "./constants";

/**
 * Embeddings are the one part of the stack Anthropic does not provide - the
 * Anthropic SDK's embedding model throws NoSuchModelError by design - so the
 * provider is pluggable.
 *
 * Voyage is Anthropic's recommended partner, Google's free tier is the
 * no-cost option, and OpenAI is there because many projects already have a
 * key. All three can emit 1024-wide vectors, so they share one column and
 * switching provider needs no migration.
 */
export type EmbeddingProvider = "voyage" | "openai" | "google";

const DEFAULT_MODELS: Record<EmbeddingProvider, string> = {
  voyage: "voyage-3.5",
  openai: "text-embedding-3-small",
  google: "gemini-embedding-001",
};

function keyFor(provider: EmbeddingProvider): string | undefined {
  switch (provider) {
    case "voyage":
      return env.VOYAGE_API_KEY;
    case "openai":
      return env.OPENAI_API_KEY;
    case "google":
      return env.GOOGLE_GENERATIVE_AI_API_KEY;
  }
}

/**
 * The provider to use: whatever was configured, or the first one holding a
 * key. Order matters only when several keys are set without an explicit
 * choice, which the README calls out.
 */
export function resolveProvider(): EmbeddingProvider | undefined {
  if (env.EMBEDDING_PROVIDER) return env.EMBEDDING_PROVIDER;

  const detected: EmbeddingProvider[] = ["voyage", "google", "openai"];
  return detected.find((provider) => keyFor(provider));
}

export function resolveModel(provider: EmbeddingProvider): string {
  return env.EMBEDDING_MODEL ?? DEFAULT_MODELS[provider];
}

function embeddingModel(provider: EmbeddingProvider): EmbeddingModel {
  const apiKey = keyFor(provider);
  if (!apiKey) {
    throw new ConfigurationError(
      `Embedding provider "${provider}" has no API key set.`,
    );
  }

  // Providers are constructed rather than taken as the packages' default
  // instances, so EMBEDDING_BASE_URL applies to all of them. Voyage's default
  // instance reads only its API key and would ignore the override.
  const baseURL = env.EMBEDDING_BASE_URL;
  const model = resolveModel(provider);

  switch (provider) {
    case "voyage":
      return createVoyage({ apiKey, baseURL }).textEmbeddingModel(model);
    case "openai":
      return createOpenAI({ apiKey, baseURL }).textEmbeddingModel(model);
    case "google":
      return createGoogleGenerativeAI({ apiKey, baseURL }).textEmbeddingModel(
        model,
      );
  }
}

/**
 * A stored passage and a search query are embedded differently by providers
 * that support it, and using the wrong side measurably degrades retrieval.
 * Voyage calls this `inputType`, Google calls it `taskType`; OpenAI has no
 * such distinction and takes only the width.
 */
function providerOptions(
  provider: EmbeddingProvider,
  side: "query" | "document",
): ProviderMetadata {
  switch (provider) {
    case "voyage":
      return {
        voyage: { inputType: side, outputDimension: EMBEDDING_DIMENSIONS },
      };
    case "google":
      return {
        google: {
          taskType: side === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
          outputDimensionality: EMBEDDING_DIMENSIONS,
        },
      };
    case "openai":
      return { openai: { dimensions: EMBEDDING_DIMENSIONS } };
  }
}

function assertWidth(vector: number[], model: string): number[] {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new ConfigurationError(
      `Embedding model "${model}" returned ${vector.length} dimensions but the vector column is ${EMBEDDING_DIMENSIONS}. Choose a model of the right width, or change EMBEDDING_DIMENSIONS and generate a migration.`,
    );
  }
  return vector;
}

function requireProvider(): EmbeddingProvider {
  const provider = resolveProvider();
  if (!provider) {
    throw new ConfigurationError(
      "Retrieval needs an embedding provider. Set GOOGLE_GENERATIVE_AI_API_KEY (free tier), VOYAGE_API_KEY, or OPENAI_API_KEY.",
    );
  }
  return provider;
}

/** Embeds stored passages. */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const provider = requireProvider();

  const { embeddings } = await embedMany({
    model: embeddingModel(provider),
    values: texts,
    providerOptions: providerOptions(provider, "document"),
  });

  return embeddings.map((vector) =>
    assertWidth(vector, resolveModel(provider)),
  );
}

/** Embeds a search query. */
export async function embedQuery(text: string): Promise<number[]> {
  const provider = requireProvider();

  const { embedding } = await embed({
    model: embeddingModel(provider),
    value: text,
    providerOptions: providerOptions(provider, "query"),
  });

  return assertWidth(embedding, resolveModel(provider));
}

/** True when some embedding provider has a key. */
export function isRagEnabled(): boolean {
  return resolveProvider() !== undefined;
}
