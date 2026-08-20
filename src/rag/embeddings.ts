import { createOpenAI } from "@ai-sdk/openai";
import { createVoyage } from "@ai-sdk/voyage";
import { embed, embedMany, type EmbeddingModel, type ProviderMetadata } from "ai";

import { env } from "@/config/env";
import { ConfigurationError } from "@/lib/errors";

import { EMBEDDING_DIMENSIONS } from "./constants";

/**
 * Embeddings are the one part of the stack Anthropic does not provide, so the
 * provider is pluggable. Voyage is the default - it is Anthropic's recommended
 * embedding partner and `voyage-3.5` is natively 1024-wide, matching the
 * vector column. OpenAI's text-embedding-3 models can be asked for 1024 too,
 * so either provider fits the same schema.
 */

/**
 * Providers are constructed rather than taken as the packages' default
 * instances, so `EMBEDDING_BASE_URL` applies to both. The Voyage default
 * instance reads only its API key from the environment and would otherwise
 * ignore the override.
 */
function embeddingModel(): EmbeddingModel {
  const baseURL = env.EMBEDDING_BASE_URL;

  switch (env.EMBEDDING_PROVIDER) {
    case "voyage": {
      if (!env.VOYAGE_API_KEY) {
        throw new ConfigurationError(
          "EMBEDDING_PROVIDER is 'voyage' but VOYAGE_API_KEY is not set.",
        );
      }
      const provider = createVoyage({ apiKey: env.VOYAGE_API_KEY, baseURL });
      return provider.textEmbeddingModel(env.EMBEDDING_MODEL);
    }

    case "openai": {
      if (!env.OPENAI_API_KEY) {
        throw new ConfigurationError(
          "EMBEDDING_PROVIDER is 'openai' but OPENAI_API_KEY is not set.",
        );
      }
      const provider = createOpenAI({ apiKey: env.OPENAI_API_KEY, baseURL });
      return provider.textEmbeddingModel(env.EMBEDDING_MODEL);
    }
  }
}

/**
 * Voyage embeds a search query and a stored passage differently, and using the
 * wrong side measurably degrades retrieval. OpenAI has no such distinction and
 * ignores the option.
 */
function providerOptions(inputType: "query" | "document"): ProviderMetadata {
  return env.EMBEDDING_PROVIDER === "voyage"
    ? { voyage: { inputType, outputDimension: EMBEDDING_DIMENSIONS } }
    : { openai: { dimensions: EMBEDDING_DIMENSIONS } };
}

function assertWidth(vector: number[]): number[] {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new ConfigurationError(
      `Embedding model "${env.EMBEDDING_MODEL}" returned ${vector.length} dimensions but the vector column is ${EMBEDDING_DIMENSIONS}. Choose a model of the right width, or change EMBEDDING_DIMENSIONS and generate a migration.`,
    );
  }
  return vector;
}

/** Embeds stored passages. */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const { embeddings } = await embedMany({
    model: embeddingModel(),
    values: texts,
    providerOptions: providerOptions("document"),
  });

  return embeddings.map(assertWidth);
}

/** Embeds a search query. */
export async function embedQuery(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: embeddingModel(),
    value: text,
    providerOptions: providerOptions("query"),
  });

  return assertWidth(embedding);
}

/** True when the configured embedding provider has its credential. */
export function isRagEnabled(): boolean {
  return env.EMBEDDING_PROVIDER === "voyage"
    ? Boolean(env.VOYAGE_API_KEY)
    : Boolean(env.OPENAI_API_KEY);
}
