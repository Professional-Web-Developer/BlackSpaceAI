import type { UIMessage } from "ai";

export type Conversation = {
  id: string;
  title: string;
  /** Id of the agent profile that runs this thread. */
  agentId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ConversationSummary = Conversation & {
  messageCount: number;
};

export type StoredMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  parts: UIMessage["parts"];
  createdAt: Date;
};

export type NewMessage = {
  id?: string;
  role: StoredMessage["role"];
  parts: UIMessage["parts"];
};

export type AgentRunMetrics = {
  conversationId: string;
  agentId: string;
  model: string;
  steps: number;
  finishReason: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  durationMs: number;
};

/**
 * The persistence port. Routes and services depend on this interface only,
 * so the Postgres and in-memory adapters are interchangeable and the storage
 * engine can be swapped without touching application code.
 */
export interface ChatRepository {
  readonly kind: "postgres" | "memory";

  listConversations(limit?: number): Promise<ConversationSummary[]>;
  getConversation(id: string): Promise<Conversation | null>;
  createConversation(input: {
    id?: string;
    title: string;
    agentId: string;
  }): Promise<Conversation>;
  renameConversation(id: string, title: string): Promise<void>;
  deleteConversation(id: string): Promise<boolean>;

  listMessages(conversationId: string): Promise<StoredMessage[]>;
  appendMessages(
    conversationId: string,
    messages: NewMessage[],
  ): Promise<StoredMessage[]>;

  recordRun(metrics: AgentRunMetrics): Promise<void>;
}
