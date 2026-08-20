/**
 * Embedding width, fixed at the schema level because a pgvector column has a
 * declared dimension. Changing it means a migration and re-embedding every
 * chunk, so it is a constant rather than an environment variable - a value
 * read from the environment would silently change what `drizzle-kit generate`
 * produces.
 *
 * 1024 is voyage-3.5's native width, and OpenAI's text-embedding-3 models can
 * be asked to emit 1024 too, so both supported providers fit the same column.
 */
export const EMBEDDING_DIMENSIONS = 1024;

/**
 * Chunking. Roughly 1,600 characters lands near 400 tokens for English prose,
 * which keeps a chunk specific enough to retrieve precisely while still
 * carrying enough context to be useful on its own. The overlap stops a fact
 * that straddles a boundary from being lost by both neighbours.
 */
export const CHUNK_TARGET_CHARS = 1600;
export const CHUNK_OVERLAP_CHARS = 200;
export const CHUNK_MIN_CHARS = 80;
