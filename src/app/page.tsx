import { redirect } from "next/navigation";

import { listAgentSummaries } from "@/agents/registry";
import { getCurrentUser } from "@/auth/service";
import { formatUsd } from "@/billing/pricing";
import { usageForUser } from "@/billing/usage";
import { Chat } from "@/components/chat";
import { env, isDatabaseEnabled, isTracingEnabled } from "@/config/env";
import { isStorageConfigured } from "@/storage/s3";
import { listConversations } from "@/services/chat-service";

// The page reads the session and stored conversations, so it cannot be
// prerendered.
export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [conversations, usage] = await Promise.all([
    listConversations(user.id),
    usageForUser(user.id),
  ]);
  const agents = listAgentSummaries();

  return (
    <main className="page">
      <header className="page-header">
        <div className="header-row">
          <h1>BlackSpace AI</h1>
          <form action="/api/auth/logout" method="post" className="account">
            <span
              className={`usage${usage.fraction >= 0.9 ? " over" : ""}`}
              title={`${formatUsd(usage.spentNanos)} of ${formatUsd(usage.limitNanos)} used this month across ${usage.runs} runs`}
            >
              <span
                className="usage-bar"
                style={{ width: `${Math.round(usage.fraction * 100)}%` }}
              />
              <span className="usage-text">
                {formatUsd(usage.spentNanos)} / {formatUsd(usage.limitNanos)}
              </span>
            </span>
            <span className="account-email">{user.email}</span>
            {user.role === "admin" && <span className="badge">admin</span>}
            <button type="submit">Sign out</button>
          </form>
        </div>
        <p>
          {agents.length} agents &middot;{" "}
          {isDatabaseEnabled ? "Postgres" : "in-memory"} storage &middot;{" "}
          {isTracingEnabled ? "Langfuse tracing on" : "tracing off"} &middot;{" "}
          {isStorageConfigured ? "S3 attachments" : "attachments off"}
        </p>
      </header>
      <Chat
        initialConversations={conversations}
        agents={agents}
        maxUploadMb={env.MAX_UPLOAD_MB}
        uploadsEnabled={isStorageConfigured}
      />
    </main>
  );
}
