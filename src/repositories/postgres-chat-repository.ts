import { count, desc, eq, asc } from "drizzle-orm";

import { getDatabase, schema } from "@/db/client";

import type {
  AgentRunMetrics,
  ChatRepository,
  Conversation,
  ConversationSummary,
  NewMessage,
  StoredMessage,
} from "./types";

export class PostgresChatRepository implements ChatRepository {
  readonly kind = "postgres" as const;

  private get db() {
    return getDatabase();
  }

  async listConversations(limit = 50): Promise<ConversationSummary[]> {
    // Left join + group by, so a conversation with no messages still appears.
    const rows = await this.db
      .select({
        id: schema.conversations.id,
        title: schema.conversations.title,
        agentId: schema.conversations.agentId,
        createdAt: schema.conversations.createdAt,
        updatedAt: schema.conversations.updatedAt,
        messageCount: count(schema.messages.id),
      })
      .from(schema.conversations)
      .leftJoin(
        schema.messages,
        eq(schema.messages.conversationId, schema.conversations.id),
      )
      .groupBy(schema.conversations.id)
      .orderBy(desc(schema.conversations.updatedAt))
      .limit(limit);

    return rows;
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const [row] = await this.db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, id))
      .limit(1);

    return row ?? null;
  }

  async createConversation(input: {
    id?: string;
    title: string;
    agentId: string;
  }): Promise<Conversation> {
    const [row] = await this.db
      .insert(schema.conversations)
      .values({ id: input.id, title: input.title, agentId: input.agentId })
      .returning();

    return row;
  }

  async renameConversation(id: string, title: string): Promise<void> {
    await this.db
      .update(schema.conversations)
      .set({ title, updatedAt: new Date() })
      .where(eq(schema.conversations.id, id));
  }

  async deleteConversation(id: string): Promise<boolean> {
    // Messages and runs are removed by the ON DELETE CASCADE constraints.
    const deleted = await this.db
      .delete(schema.conversations)
      .where(eq(schema.conversations.id, id))
      .returning({ id: schema.conversations.id });

    return deleted.length > 0;
  }

  async listMessages(conversationId: string): Promise<StoredMessage[]> {
    return this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId))
      .orderBy(asc(schema.messages.createdAt));
  }

  async appendMessages(
    conversationId: string,
    newMessages: NewMessage[],
  ): Promise<StoredMessage[]> {
    if (newMessages.length === 0) return [];

    // One transaction so a turn is never half-persisted: either the messages
    // and the conversation timestamp both land, or neither does.
    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.messages)
        .values(
          newMessages.map((message) => ({
            id: message.id,
            conversationId,
            role: message.role,
            parts: message.parts,
          })),
        )
        .returning();

      await tx
        .update(schema.conversations)
        .set({ updatedAt: new Date() })
        .where(eq(schema.conversations.id, conversationId));

      return inserted;
    });
  }

  async recordRun(metrics: AgentRunMetrics): Promise<void> {
    await this.db.insert(schema.agentRuns).values(metrics);
  }
}
