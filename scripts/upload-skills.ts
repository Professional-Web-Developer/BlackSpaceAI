/**
 * Uploads every skill folder under `skills/` to Anthropic and records the ids
 * it gets back in `skills/uploaded.json`, which the runtime reads to turn a
 * profile's skill names into skill ids.
 *
 *   npm run skills:upload
 *
 * Skill ids are per-account, so re-run this after switching accounts. It is
 * safe to run repeatedly; each run creates a new version.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { anthropic } from "@ai-sdk/anthropic";

const SKILLS_DIR = join(process.cwd(), "skills");
const MANIFEST = join(SKILLS_DIR, "uploaded.json");

/** Everything in a skill folder is uploaded, at paths relative to its root. */
function collectFiles(root: string, directory = root): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    return statSync(full).isDirectory() ? collectFiles(root, full) : [full];
  });
}

function skillFolders(): string[] {
  return readdirSync(SKILLS_DIR).filter((entry) => {
    const full = join(SKILLS_DIR, entry);
    return statSync(full).isDirectory();
  });
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY must be set to upload skills");
  }

  const folders = skillFolders();
  if (folders.length === 0) {
    console.log("No skill folders under skills/ - nothing to upload.");
    return;
  }

  const skills = anthropic.skills();
  const uploaded: {
    name: string;
    providerReference: Record<string, string>;
    version?: string;
  }[] = [];

  for (const name of folders) {
    const root = join(SKILLS_DIR, name);
    const paths = collectFiles(root);

    if (!paths.some((path) => path.endsWith("SKILL.md"))) {
      throw new Error(`skills/${name} has no SKILL.md`);
    }

    const result = await skills.uploadSkill({
      displayTitle: name,
      files: paths.map((path) => ({
        path: relative(root, path),
        data: { type: "text" as const, text: readFileSync(path, "utf8") },
      })),
    });

    // The upload returns a provider reference rather than a bare id, which is
    // exactly the shape the container option accepts, so it is stored as-is.
    uploaded.push({
      name,
      providerReference: result.providerReference,
      ...(result.latestVersion ? { version: result.latestVersion } : {}),
    });

    console.log(
      `uploaded ${name} -> ${JSON.stringify(result.providerReference)}`,
    );
  }

  writeFileSync(MANIFEST, `${JSON.stringify(uploaded, null, 2)}\n`);
  console.log(`\nWrote ${relative(process.cwd(), MANIFEST)}`);
}

main().catch((error: unknown) => {
  console.error("Skill upload failed:", error);
  process.exit(1);
});
