/**
 * Which models support server-side compaction.
 *
 * Sending `compact_20260112` to a model that does not support it is a 400 on
 * every request, and the model is configurable via ANTHROPIC_MODEL, so this is
 * checked when profiles load.
 *
 * UPDATE THIS when adopting a newer model.
 */
const COMPACTION_CAPABLE = new Set([
  "claude-fable-5",
  "claude-mythos-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
]);

export function supportsCompaction(model: string): boolean {
  return COMPACTION_CAPABLE.has(model);
}
