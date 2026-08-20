import type { UIMessage } from "ai";

import { logger } from "@/lib/logger";
import { NotFoundError } from "@/lib/errors";
import { getChatRepository } from "@/repositories";
import type {
  AgentRunMetrics,
  Conversation,
  ConversationSummary,
  StoredMessage,
} from "@/repositories";

const TITLE_MAX_LENGTH = 60;
const NEW_CONVERSATION_TITLE = "New conversation";

/** Best-effort thread title taken from the first thing the user said. */
function deriveTitle(parts: UIMessage["parts"]): string {
  const text = parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return NEW_CONVERSATION_TITLE;
  return text.length > TITLE_MAX_LENGTH
    ? `${text.slice(0, TITLE_MAX_LENGTH - 1)}…`
    : text;
}

/** Storage rows back into the shape the AI SDK and the client expect. */
export function toUIMessage(message: StoredMessage): UIMessage {
  return {
    id: message.id,
    role: message.role,
    parts: message.parts,
  };
}

export type PreparedTurn = {
  conversation: Conversation;
  /** Full history including the message that was just persisted. */
  messages: UIMessage[];
};

/**
 * Opens a turn: resolves (or creates) the thread, persists the incoming user
 * message, and returns the history the model should see. The client only ever
 * sends the newest message, so this is the single place history is assembled.
 */
export async function prepareTurn(input: {
  conversationId: string;
  message: { id: string; role: "user"; parts: UIMessage["parts"] };
}): Promise<PreparedTurn> {
  const repository = getChatRepository();

  // The client generates the thread id, so the first message of a new thread
  // creates it. That keeps the request idempotent and means the client never
  // has to wait for an id to come back before it can render.
  const conversation =
    (await repository.getConversation(input.conversationId)) ??
    (await repository.createConversation({
      id: input.conversationId,
      title: deriveTitle(input.message.parts),
    }));

  const history = await repository.listMessages(conversation.id);

  const [persisted] = await repository.appendMessages(conversation.id, [
    { id: input.message.id, role: "user", parts: input.message.parts },
  ]);

  return {
    conversation,
    messages: [...history.map(toUIMessage), toUIMessage(persisted)],
  };
}

/**
 * Closes a turn: persists the assistant message (including its tool calls and
 * their outputs) and records the run metrics. Failures are logged rather than
 * thrown - the user already has their answer, and losing a metrics row should
 * not surface as a request error.
 */
export async function completeTurn(input: {
  conversationId: string;
  assistantMessage: UIMessage;
  metrics: Omit<AgentRunMetrics, "conversationId">;
}): Promise<void> {
  const repository = getChatRepository();

  try {
    await repository.appendMessages(input.conversationId, [
      {
        id: input.assistantMessage.id,
        role: "assistant",
        parts: input.assistantMessage.parts,
      },
    ]);

    await repository.recordRun({
      conversationId: input.conversationId,
      ...input.metrics,
    });
  } catch (error) {
    logger.error("Failed to persist assistant turn", {
      conversationId: input.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Serialisable view of a conversation. Timestamps are ISO strings so the same
 * shape crosses both boundaries unchanged: the JSON API and the server-to-
 * client component payload.
 */
export type ConversationSummaryDTO = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

function toSummaryDTO(summary: ConversationSummary): ConversationSummaryDTO {
  return {
    id: summary.id,
    title: summary.title,
    createdAt: summary.createdAt.toISOString(),
    updatedAt: summary.updatedAt.toISOString(),
    messageCount: summary.messageCount,
  };
}

export async function listConversations(
  limit?: number,
): Promise<ConversationSummaryDTO[]> {
  const summaries = await getChatRepository().listConversations(limit);
  return summaries.map(toSummaryDTO);
}

export async function getConversationWithMessages(id: string) {
  const repository = getChatRepository();

  const conversation = await repository.getConversation(id);
  if (!conversation) throw new NotFoundError("Conversation");

  const messages = await repository.listMessages(id);
  return { conversation, messages: messages.map(toUIMessage) };
}

export async function deleteConversation(id: string): Promise<void> {
  const deleted = await getChatRepository().deleteConversation(id);
  if (!deleted) throw new NotFoundError("Conversation");
}
