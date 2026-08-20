import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { UIMessage } from "ai";

/** A chat thread. Deleting one cascades to its messages and runs. */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    /**
     * Which agent profile ran this thread. Stored as a plain string rather
     * than an enum so adding a profile does not require a migration; unknown
     * ids fall back to the default when a thread is reopened.
     */
    agentId: text("agent_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("conversations_updated_at_idx").on(table.updatedAt)],
);

/**
 * One message in a thread. AI SDK messages are part arrays (text, reasoning,
 * tool calls and their outputs), so the parts are stored as JSONB rather than
 * flattened to a string - that keeps tool calls replayable.
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    parts: jsonb("parts").$type<UIMessage["parts"]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt,
    ),
  ],
);

/**
 * One agent turn: the metrics that make cost and behaviour reviewable
 * (steps taken, tokens spent, why it stopped, how long it took).
 */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    model: text("model").notNull(),
    steps: integer("steps").notNull(),
    finishReason: text("finish_reason").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    durationMs: integer("duration_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("agent_runs_conversation_idx").on(table.conversationId)],
);

export const conversationsRelations = relations(conversations, ({ many }) => ({
  messages: many(messages),
  runs: many(agentRuns),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const agentRunsRelations = relations(agentRuns, ({ one }) => ({
  conversation: one(conversations, {
    fields: [agentRuns.conversationId],
    references: [conversations.id],
  }),
}));

export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type AgentRunRow = typeof agentRuns.$inferSelect;
