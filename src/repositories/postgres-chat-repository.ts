import { and, count, desc, eq, asc } from "drizzle-orm";

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

  async listConversations(
    userId: string,
    limit = 50,
  ): Promise<ConversationSummary[]> {
    // Left join + group by, so a conversation with no messages still appears.
    const rows = await this.db
      .select({
        id: schema.conversations.id,
        userId: schema.conversations.userId,
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
      .where(eq(schema.conversations.userId, userId))
      .groupBy(schema.conversations.id)
      .orderBy(desc(schema.conversations.updatedAt))
      .limit(limit);

    return rows;
  }

  async getConversation(
    id: string,
    userId: string,
  ): Promise<Conversation | null> {
    const [row] = await this.db
      .select()
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.id, id),
          eq(schema.conversations.userId, userId),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  async createConversation(input: {
    id?: string;
    userId: string;
    title: string;
    agentId: string;
  }): Promise<Conversation> {
    const [row] = await this.db
      .insert(schema.conversations)
      .values({
        id: input.id,
        userId: input.userId,
        title: input.title,
        agentId: input.agentId,
      })
      .returning();

    return row;
  }

  async renameConversation(
    id: string,
    userId: string,
    title: string,
  ): Promise<void> {
    await this.db
      .update(schema.conversations)
      .set({ title, updatedAt: new Date() })
      .where(
        and(
          eq(schema.conversations.id, id),
          eq(schema.conversations.userId, userId),
        ),
      );
  }

  async deleteConversation(id: string, userId: string): Promise<boolean> {
    // Messages and runs are removed by the ON DELETE CASCADE constraints.
    // Scoping by owner means another user's id simply deletes nothing, which
    // the caller reports as a 404 rather than a 403 - not revealing that the
    // thread exists at all.
    const deleted = await this.db
      .delete(schema.conversations)
      .where(
        and(
          eq(schema.conversations.id, id),
          eq(schema.conversations.userId, userId),
        ),
      )
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
