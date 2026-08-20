"use client";

import type { AgentSummary } from "@/agents/types";

type AgentPickerProps = {
  agents: AgentSummary[];
  selectedId: string;
  /** True once the thread has history; the agent can no longer be changed. */
  locked: boolean;
  onSelect: (id: string) => void;
};

export function AgentPicker({
  agents,
  selectedId,
  locked,
  onSelect,
}: AgentPickerProps) {
  const selected = agents.find((agent) => agent.id === selectedId);

  if (locked) {
    return (
      <div className="agent-bar locked">
        <span className="agent-name">{selected?.name ?? selectedId}</span>
        <span className="agent-note">
          set when this conversation started
        </span>
      </div>
    );
  }

  return (
    <div className="agent-bar">
      <div className="agent-options" role="radiogroup" aria-label="Agent">
        {agents.map((agent) => (
          <button
            key={agent.id}
            type="button"
            role="radio"
            aria-checked={agent.id === selectedId}
            className={agent.id === selectedId ? "selected" : ""}
            onClick={() => onSelect(agent.id)}
          >
            {agent.name}
          </button>
        ))}
      </div>
      {selected && (
        <p className="agent-description">
          {selected.description}
          <span className="agent-tools">
            {selected.tools.join(" · ")}
            {selected.usesNetwork ? " · reaches the web" : " · no network"}
          </span>
        </p>
      )}
    </div>
  );
}
