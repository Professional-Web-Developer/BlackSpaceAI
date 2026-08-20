"use client";

import type { UIMessage } from "ai";
import { useCallback, useState } from "react";

import type { ConversationSummaryDTO } from "@/services/chat-service";

import { ChatPanel } from "./chat-panel";

type ChatProps = {
  /** Rendered on the server, so the sidebar has content on first paint. */
  initialConversations: ConversationSummaryDTO[];
};

export function Chat({ initialConversations }: ChatProps) {
  // The client mints the thread id so the first message already belongs to an
  // addressable conversation; the server creates the row on first use.
  const [conversationId, setConversationId] = useState(() =>
    crypto.randomUUID(),
  );
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [conversations, setConversations] =
    useState<ConversationSummaryDTO[]>(initialConversations);

  // Refreshed only in response to something the user did - after a turn
  // completes, or after a delete - so there is no render-triggered fetch.
  const refreshConversations = useCallback(async () => {
    try {
      const response = await fetch("/api/conversations");
      if (!response.ok) return;
      const data: { conversations: ConversationSummaryDTO[] } =
        await response.json();
      setConversations(data.conversations);
    } catch {
      // The sidebar is not essential; a failed refresh should not break chat.
    }
  }, []);

  async function openConversation(id: string) {
    const response = await fetch(`/api/conversations/${id}`);
    if (!response.ok) return;
    const data: { messages: UIMessage[] } = await response.json();
    setInitialMessages(data.messages);
    setConversationId(id);
  }

  function startNewConversation() {
    setInitialMessages([]);
    setConversationId(crypto.randomUUID());
  }

  async function removeConversation(id: string) {
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (id === conversationId) startNewConversation();
    await refreshConversations();
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <button type="button" className="new-chat" onClick={startNewConversation}>
          New conversation
        </button>
        <ul>
          {conversations.map((conversation) => (
            <li
              key={conversation.id}
              className={conversation.id === conversationId ? "active" : ""}
            >
              <button
                type="button"
                onClick={() => void openConversation(conversation.id)}
              >
                <span className="title">{conversation.title}</span>
                <span className="meta">{conversation.messageCount} messages</span>
              </button>
              <button
                type="button"
                className="delete"
                aria-label={`Delete ${conversation.title}`}
                onClick={() => void removeConversation(conversation.id)}
              >
                ×
              </button>
            </li>
          ))}
          {conversations.length === 0 && (
            <li className="placeholder">No saved conversations yet</li>
          )}
        </ul>
      </aside>

      <section className="conversation">
        <ChatPanel
          key={conversationId}
          conversationId={conversationId}
          initialMessages={initialMessages}
          onTurnComplete={() => void refreshConversations()}
        />
      </section>
    </div>
  );
}
