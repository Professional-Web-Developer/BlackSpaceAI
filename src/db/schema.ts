import { relations } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import type { UIMessage } from "ai";

import { EMBEDDING_DIMENSIONS } from "@/rag/constants";

/**
 * An account. Email is stored lower-cased and unique, so lookups and the
 * uniqueness guarantee agree - Postgres comparisons are case-sensitive, and
 * without normalising, "Kavin@x.com" and "kavin@x.com" would be two accounts.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    /** scrypt output plus its parameters and salt; see src/auth/password.ts. */
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ["admin", "member"] })
      .notNull()
      .default("member"),
    /**
     * Monthly spending cap in nano-dollars. Null means "use the deployment
     * default", so raising the default lifts everyone who has no override.
     */
    monthlyLimitNanos: bigint("monthly_limit_nanos", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (table) => [index("users_email_idx").on(table.email)],
);

/**
 * Server-side sessions rather than stateless tokens, so signing out and
 * revoking access take effect immediately. Only a hash of the session token is
 * stored: a database leak then does not hand over live sessions.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("sessions_token_hash_idx").on(table.tokenHash),
    index("sessions_user_idx").on(table.userId),
  ],
);

/** A chat thread. Deleting one cascades to its messages and runs. */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Owner. Conversations are private to the user who created them. */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
  (table) => [
    // The listing is always "this user's threads, newest first", so the index
    // leads with the owner.
    index("conversations_user_updated_idx").on(table.userId, table.updatedAt),
  ],
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
    /** Split out because cached input is billed at a tenth of the rate. */
    cacheReadTokens: integer("cache_read_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    /**
     * Cost of this turn in nano-dollars. Integer, so summing a month of runs
     * involves no floating point drift. Denormalised deliberately: prices
     * change, and a run should keep the cost it was actually billed at.
     */
    costNanos: bigint("cost_nanos", { mode: "number" }).notNull().default(0),
    durationMs: integer("duration_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("agent_runs_conversation_idx").on(table.conversationId),
    // The spend query is always "this user, this month", and agent_runs has no
    // user column - it joins through conversations - so this index serves the
    // date half of that.
    index("agent_runs_created_at_idx").on(table.createdAt),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  conversations: many(conversations),
  sessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, {
    fields: [conversations.userId],
    references: [users.id],
  }),
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

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type AgentRunRow = typeof agentRuns.$inferSelect;

/**
 * A file uploaded straight to S3 by the browser.
 *
 * The row is written when the upload is authorised, before the bytes exist, so
 * a row with `uploadedAt` still null means the browser never finished. Those
 * are safe to sweep.
 */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Object key in the bucket; never exposed to the client. */
    objectKey: text("object_key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Set when the browser confirms the upload finished. */
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
  },
  (table) => [index("attachments_user_idx").on(table.userId)],
);

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  user: one(users, { fields: [attachments.userId], references: [users.id] }),
}));

export type AttachmentRow = typeof attachments.$inferSelect;

/**
 * A source document in the knowledge base. The full text is kept alongside the
 * chunks so a document can be re-chunked and re-embedded when the chunking
 * strategy or the embedding model changes, without re-fetching the original.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    /** Where this came from: a URL, a filename, an internal id. */
    source: text("source"),
    content: text("content").notNull(),
    /** Who ingested it. Null for documents ingested by the CLI script. */
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("documents_created_at_idx").on(table.createdAt)],
);

/**
 * One embedded passage. The HNSW index is built for cosine distance, which is
 * what the retrieval query uses - a mismatch between the two silently falls
 * back to a sequential scan.
 */
export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** Position within the document, so retrieved passages can be ordered. */
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", {
      dimensions: EMBEDDING_DIMENSIONS,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("document_chunks_document_idx").on(table.documentId),
    index("document_chunks_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  ],
);

export const documentsRelations = relations(documents, ({ many }) => ({
  chunks: many(documentChunks),
}));

export const documentChunksRelations = relations(documentChunks, ({ one }) => ({
  document: one(documents, {
    fields: [documentChunks.documentId],
    references: [documents.id],
  }),
}));

export type DocumentRow = typeof documents.$inferSelect;
export type DocumentChunkRow = typeof documentChunks.$inferSelect;
