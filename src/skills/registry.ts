import { readFileSync } from "node:fs";
import { join } from "node:path";

import { logger } from "@/lib/logger";

/**
 * Agent Skills are folders of instructions and scripts that Claude loads on
 * demand inside the code execution sandbox. They live in `skills/` in this
 * repo, and `npm run skills:upload` uploads them to Anthropic and writes the
 * ids it gets back to `skills/uploaded.json`.
 *
 * That file is per-account, so it may be missing - on a fresh clone, in CI, or
 * before the first upload. A missing entry is a warning, not an error: the
 * agent still runs, just without the skill.
 */

export type UploadedSkill = {
  /** Folder name under `skills/`. */
  name: string;
  /** What the upload returned; the container option takes it unchanged. */
  providerReference: Record<string, string>;
  version?: string;
};

export type SkillReference = {
  type: "custom";
  providerReference: Record<string, string>;
  version?: string;
};

const MANIFEST_PATH = join(process.cwd(), "skills", "uploaded.json");

function loadManifest(): Map<string, UploadedSkill> {
  try {
    const raw = readFileSync(MANIFEST_PATH, "utf8");
    const parsed: UploadedSkill[] = JSON.parse(raw);
    return new Map(parsed.map((skill) => [skill.name, skill]));
  } catch {
    return new Map();
  }
}

const manifest = loadManifest();

export function isSkillUploaded(name: string): boolean {
  return manifest.has(name);
}

/**
 * Turns the skill names on a profile into the reference shape the Anthropic
 * container option expects, dropping any that have not been uploaded.
 */
export function resolveSkills(
  names: readonly string[],
  agentId: string,
): SkillReference[] {
  const resolved: SkillReference[] = [];

  for (const name of names) {
    const skill = manifest.get(name);
    if (!skill) {
      logger.warn(
        "Skill not uploaded - agent will run without it (run `npm run skills:upload`)",
        { agent: agentId, skill: name },
      );
      continue;
    }
    resolved.push({
      type: "custom",
      providerReference: skill.providerReference,
      ...(skill.version ? { version: skill.version } : {}),
    });
  }

  return resolved;
}
