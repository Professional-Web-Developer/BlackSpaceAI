import type { UIMessage } from "ai";

export type Conversation = {
  id: string;
  userId: string;
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
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Cost of the turn in nano-dollars, priced when the turn finished. */
  costNanos: number;
  durationMs: number;
};

/**
 * The persistence port. Routes and services depend on this interface only,
 * so the Postgres and in-memory adapters are interchangeable and the storage
 * engine can be swapped without touching application code.
 */
export interface ChatRepository {
  readonly kind: "postgres" | "memory";

  /**
   * Ownership is enforced here rather than in the routes. Every read and write
   * takes the acting user, so a missed check in a handler cannot expose
   * another user's thread - the query simply will not match.
   */
  listConversations(userId: string, limit?: number): Promise<ConversationSummary[]>;
  getConversation(id: string, userId: string): Promise<Conversation | null>;
  createConversation(input: {
    id?: string;
    userId: string;
    title: string;
    agentId: string;
  }): Promise<Conversation>;
  renameConversation(id: string, userId: string, title: string): Promise<void>;
  deleteConversation(id: string, userId: string): Promise<boolean>;

  listMessages(conversationId: string): Promise<StoredMessage[]>;
  appendMessages(
    conversationId: string,
    messages: NewMessage[],
  ): Promise<StoredMessage[]>;

  recordRun(metrics: AgentRunMetrics): Promise<void>;
}
