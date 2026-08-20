import {
  CHUNK_MIN_CHARS,
  CHUNK_OVERLAP_CHARS,
  CHUNK_TARGET_CHARS,
} from "./constants";

export type Chunk = {
  index: number;
  content: string;
};

/**
 * Splits text on paragraph boundaries first, falling back to sentences and
 * then to a hard cut, so a chunk is a coherent passage wherever the source
 * allows it. Splitting purely on character count is what makes naive RAG
 * retrieve half-sentences.
 */
function splitLongParagraph(paragraph: string): string[] {
  if (paragraph.length <= CHUNK_TARGET_CHARS) return [paragraph];

  const sentences = paragraph.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [
    paragraph,
  ];

  const pieces: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    // A single sentence longer than a whole chunk only happens in pathological
    // input (minified text, no punctuation); cut it rather than emit a chunk
    // the embedding model would truncate anyway.
    if (sentence.length > CHUNK_TARGET_CHARS) {
      if (current) {
        pieces.push(current);
        current = "";
      }
      for (let at = 0; at < sentence.length; at += CHUNK_TARGET_CHARS) {
        pieces.push(sentence.slice(at, at + CHUNK_TARGET_CHARS));
      }
      continue;
    }

    if (current.length + sentence.length > CHUNK_TARGET_CHARS) {
      pieces.push(current);
      current = sentence;
    } else {
      current += sentence;
    }
  }

  if (current) pieces.push(current);
  return pieces;
}

export function chunkText(text: string): Chunk[] {
  const normalised = text.replace(/\r\n/g, "\n").trim();
  if (!normalised) return [];

  const paragraphs = normalised
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap(splitLongParagraph);

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph;
      continue;
    }

    if (current.length + paragraph.length + 2 <= CHUNK_TARGET_CHARS) {
      current = `${current}\n\n${paragraph}`;
      continue;
    }

    chunks.push(current);
    // Carry the tail of the previous chunk into the next one so a fact split
    // across the boundary is retrievable from either side.
    const overlap = current.slice(-CHUNK_OVERLAP_CHARS);
    const boundary = overlap.indexOf(" ");
    current =
      boundary === -1
        ? paragraph
        : `${overlap.slice(boundary + 1)}\n\n${paragraph}`;
  }

  if (current) chunks.push(current);

  return chunks
    .map((content) => content.trim())
    .filter((content) => content.length >= CHUNK_MIN_CHARS)
    .map((content, index) => ({ index, content }));
}
