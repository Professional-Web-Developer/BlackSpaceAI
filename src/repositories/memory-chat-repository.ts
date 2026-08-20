import { randomUUID } from "node:crypto";

import type {
  AgentRunMetrics,
  ChatRepository,
  Conversation,
  ConversationSummary,
  NewMessage,
  StoredMessage,
} from "./types";

/**
 * Process-local implementation used when DATABASE_URL is not set, so a fresh
 * clone runs with no infrastructure. State is lost on restart and is not
 * shared between server instances - it is a development convenience, not a
 * production store.
 */
export class MemoryChatRepository implements ChatRepository {
  readonly kind = "memory" as const;

  private readonly conversations = new Map<string, Conversation>();
  private readonly messages = new Map<string, StoredMessage[]>();
  private readonly runs: AgentRunMetrics[] = [];

  async listConversations(
    userId: string,
    limit = 50,
  ): Promise<ConversationSummary[]> {
    return [...this.conversations.values()]
      .filter((conversation) => conversation.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, limit)
      .map((conversation) => ({
        ...conversation,
        messageCount: this.messages.get(conversation.id)?.length ?? 0,
      }));
  }

  async getConversation(
    id: string,
    userId: string,
  ): Promise<Conversation | null> {
    const conversation = this.conversations.get(id);
    return conversation?.userId === userId ? conversation : null;
  }

  async createConversation(input: {
    id?: string;
    userId: string;
    title: string;
    agentId: string;
  }): Promise<Conversation> {
    const now = new Date();
    const conversation: Conversation = {
      id: input.id ?? randomUUID(),
      userId: input.userId,
      title: input.title,
      agentId: input.agentId,
      createdAt: now,
      updatedAt: now,
    };

    this.conversations.set(conversation.id, conversation);
    this.messages.set(conversation.id, []);
    return conversation;
  }

  async renameConversation(
    id: string,
    userId: string,
    title: string,
  ): Promise<void> {
    const conversation = this.conversations.get(id);
    if (conversation?.userId !== userId) return;
    this.conversations.set(id, { ...conversation, title, updatedAt: new Date() });
  }

  async deleteConversation(id: string, userId: string): Promise<boolean> {
    if (this.conversations.get(id)?.userId !== userId) return false;
    this.messages.delete(id);
    return this.conversations.delete(id);
  }

  async listMessages(conversationId: string): Promise<StoredMessage[]> {
    return [...(this.messages.get(conversationId) ?? [])];
  }

  async appendMessages(
    conversationId: string,
    newMessages: NewMessage[],
  ): Promise<StoredMessage[]> {
    const existing = this.messages.get(conversationId) ?? [];

    const inserted: StoredMessage[] = newMessages.map((message) => ({
      id: message.id ?? randomUUID(),
      conversationId,
      role: message.role,
      parts: message.parts,
      createdAt: new Date(),
    }));

    this.messages.set(conversationId, [...existing, ...inserted]);

    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      this.conversations.set(conversationId, {
        ...conversation,
        updatedAt: new Date(),
      });
    }

    return inserted;
  }

  async recordRun(metrics: AgentRunMetrics): Promise<void> {
    this.runs.push(metrics);
  }
}
