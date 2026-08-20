import { NotFoundError } from "@/lib/errors";
import {
  INCOMPATIBLE_TOOL_PAIRS,
  NETWORK_TOOL_NAMES,
  TOOL_LABELS,
  toolRegistry,
} from "@/tools/registry";

import { builtInAgents, DEFAULT_AGENT_ID } from "./profiles";
import type { AgentProfile, AgentSummary } from "./types";

/**
 * Validated once, at module load, so a malformed profile is a startup failure
 * rather than a confusing model response in production.
 */
function assertProfileIsValid(profile: AgentProfile): void {
  const where = `Agent "${profile.id}"`;

  if (profile.tools.length === 0) {
    throw new Error(`${where} declares no tools.`);
  }

  for (const name of profile.tools) {
    if (!(name in toolRegistry)) {
      throw new Error(`${where} references unknown tool "${name}".`);
    }
  }

  if (new Set(profile.tools).size !== profile.tools.length) {
    throw new Error(`${where} lists the same tool twice.`);
  }

  for (const [first, second] of INCOMPATIBLE_TOOL_PAIRS) {
    if (profile.tools.includes(first) && profile.tools.includes(second)) {
      throw new Error(
        `${where} combines "${first}" and "${second}", which cannot be used together.`,
      );
    }
  }

  if (profile.maxSteps < 1) {
    throw new Error(`${where} has a maxSteps below 1.`);
  }

  // Anthropic rejects disabled thinking above `high` effort with a 400.
  if (!profile.thinking && (profile.effort === "xhigh" || profile.effort === "max")) {
    throw new Error(
      `${where} disables thinking at "${profile.effort}" effort, which the API rejects. Use "high" or below, or leave thinking on.`,
    );
  }
}

function buildRegistry(profiles: AgentProfile[]): Map<string, AgentProfile> {
  const registry = new Map<string, AgentProfile>();

  for (const profile of profiles) {
    assertProfileIsValid(profile);
    if (registry.has(profile.id)) {
      throw new Error(`Duplicate agent id "${profile.id}".`);
    }
    registry.set(profile.id, profile);
  }

  if (!registry.has(DEFAULT_AGENT_ID)) {
    throw new Error(`Default agent "${DEFAULT_AGENT_ID}" is not registered.`);
  }

  return registry;
}

const registry = buildRegistry(builtInAgents);

export function listAgents(): AgentProfile[] {
  return [...registry.values()];
}

/** Returns the profile, or the default when the id is unknown or absent. */
export function getAgentOrDefault(id: string | undefined): AgentProfile {
  if (!id) return registry.get(DEFAULT_AGENT_ID)!;
  return registry.get(id) ?? registry.get(DEFAULT_AGENT_ID)!;
}

/** Returns the profile, or throws when the id is unknown. */
export function getAgent(id: string): AgentProfile {
  const profile = registry.get(id);
  if (!profile) throw new NotFoundError(`Agent "${id}"`);
  return profile;
}

export function isKnownAgent(id: string): boolean {
  return registry.has(id);
}

/** The client-safe view: no prompt text crosses the wire. */
export function toAgentSummary(profile: AgentProfile): AgentSummary {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    tools: profile.tools.map((name) => TOOL_LABELS[name]),
    usesNetwork: profile.tools.some((name) =>
      NETWORK_TOOL_NAMES.includes(name),
    ),
  };
}

export function listAgentSummaries(): AgentSummary[] {
  return listAgents().map(toAgentSummary);
}

export { DEFAULT_AGENT_ID } from "./profiles";
export type { AgentProfile, AgentSummary } from "./types";
