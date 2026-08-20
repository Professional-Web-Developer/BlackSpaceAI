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

/**
 * Password rules follow NIST guidance: length is what matters, so a long
 * minimum with no composition rules. The upper bound exists because the whole
 * string is fed to scrypt, and an unbounded one is a cheap way to burn CPU.
 */
export const credentialsSchema = z.object({
  email: z.email("Enter a valid email address").max(320),
  password: z
    .string()
    .min(12, "Use at least 12 characters")
    .max(200, "Passwords must be under 200 characters"),
});

/**
 * Types Claude can actually read. Anything else would upload successfully and
 * then fail at the model, so it is rejected at the presign step instead.
 */
export const ALLOWED_UPLOAD_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
] as const;

export const presignUploadSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.enum(ALLOWED_UPLOAD_TYPES),
  sizeBytes: z.number().int().positive(),
});

export const attachmentIdSchema = z.uuid("Invalid attachment id");
