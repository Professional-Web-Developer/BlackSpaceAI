import { z } from "zod";

/**
 * Message parts are validated structurally rather than exhaustively: the AI
 * SDK adds part types over time, and rejecting unknown ones would break the
 * client on a minor upgrade. What matters here is that `parts` is a list of
 * objects carrying a `type`, which is what the renderer and the store assume.
 */
const messagePartSchema = z
  .object({ type: z.string() })
  .catchall(z.unknown());

export const incomingMessageSchema = z.object({
  id: z.string().min(1).max(128),
  role: z.literal("user"),
  parts: z.array(messagePartSchema).min(1).max(64),
});

export const chatRequestSchema = z.object({
  /** Client-generated, so the thread is addressable from the first message. */
  conversationId: z.uuid(),
  /**
   * Which agent to run. Only honoured when the thread is being created; an
   * existing thread keeps the agent it started with. Unknown ids fall back to
   * the default rather than failing the request.
   */
  agentId: z.string().min(1).max(64).optional(),
  /** Only the new message is sent; history is loaded server-side. */
  message: incomingMessageSchema,
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const conversationIdSchema = z.uuid("Invalid conversation id");

export const listConversationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const ingestDocumentSchema = z.object({
  title: z.string().min(1).max(300),
  content: z.string().min(20).max(1_000_000),
  source: z.string().max(2000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const documentIdSchema = z.uuid("Invalid document id");
