/**
 * Ingests local files into the knowledge base.
 *
 *   npm run rag:ingest -- ./docs/handbook.md ./docs/policy.txt
 *
 * The title defaults to the filename; pass --title to override when ingesting
 * a single file.
 */
import { basename } from "node:path";
import { readFile } from "node:fs/promises";

import { ingestDocument } from "@/rag/store";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const titleFlag = args.indexOf("--title");
  const title = titleFlag === -1 ? undefined : args[titleFlag + 1];
  // Guarded on `titleFlag !== -1`: without it, an absent --title makes
  // `titleFlag + 1` equal 0 and the first file is silently dropped.
  const titleValueIndex = titleFlag === -1 ? -1 : titleFlag + 1;
  const paths = args.filter(
    (arg, index) => !arg.startsWith("--") && index !== titleValueIndex,
  );

  if (paths.length === 0) {
    throw new Error("Usage: npm run rag:ingest -- <file> [file...]");
  }
  if (title && paths.length > 1) {
    throw new Error("--title only makes sense with a single file");
  }

  for (const path of paths) {
    const content = await readFile(path, "utf8");
    const result = await ingestDocument({
      title: title ?? basename(path),
      content,
      source: path,
    });
    console.log(`${path} -> ${result.chunks} chunks (${result.documentId})`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
