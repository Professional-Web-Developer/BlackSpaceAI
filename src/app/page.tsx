import { listAgentSummaries } from "@/agents/registry";
import { Chat } from "@/components/chat";
import { isDatabaseEnabled, isTracingEnabled } from "@/config/env";
import { listConversations } from "@/services/chat-service";

// The page reads stored conversations, so it cannot be prerendered.
export const dynamic = "force-dynamic";

export default async function Home() {
  const [conversations, agents] = await Promise.all([
    listConversations(),
    Promise.resolve(listAgentSummaries()),
  ]);

  return (
    <main className="page">
      <header className="page-header">
        <h1>BlackSpace AI</h1>
        <p>
          {agents.length} agents &middot;{" "}
          {isDatabaseEnabled ? "Postgres" : "in-memory"} storage &middot;{" "}
          {isTracingEnabled ? "Langfuse tracing on" : "tracing off"}
        </p>
      </header>
      <Chat initialConversations={conversations} agents={agents} />
    </main>
  );
}
