import { Chat } from "@/components/chat";
import { isDatabaseEnabled, isTracingEnabled } from "@/config/env";
import { MAX_STEPS, MODEL_ID } from "@/lib/agent";
import { listConversations } from "@/services/chat-service";

// The page reads stored conversations, so it cannot be prerendered.
export const dynamic = "force-dynamic";

export default async function Home() {
  const conversations = await listConversations();

  return (
    <main className="page">
      <header className="page-header">
        <h1>BlackSpace AI</h1>
        <p>
          {MODEL_ID} &middot; up to {MAX_STEPS} steps per turn &middot;{" "}
          {isDatabaseEnabled ? "Postgres" : "in-memory"} storage &middot;{" "}
          {isTracingEnabled ? "Langfuse tracing on" : "tracing off"}
        </p>
      </header>
      <Chat initialConversations={conversations} />
    </main>
  );
}
