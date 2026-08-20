import type { UIMessage } from "ai";

import { getAgentOrDefault, type AgentProfile } from "@/agents/registry";
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
  /** The profile that runs this turn. */
  agent: AgentProfile;
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
  userId: string;
  agentId?: string;
  message: { id: string; role: "user"; parts: UIMessage["parts"] };
}): Promise<PreparedTurn> {
  const repository = getChatRepository();

  // The client generates the thread id, so the first message of a new thread
  // creates it. That keeps the request idempotent and means the client never
  // has to wait for an id to come back before it can render.
  //
  // A thread id belonging to someone else does not resolve, so this creates a
  // new empty thread for the caller rather than appending to theirs. The
  // insert then fails on the primary key, which is the correct outcome: it
  // never silently writes into another user's conversation.
  const conversation =
    (await repository.getConversation(input.conversationId, input.userId)) ??
    (await repository.createConversation({
      id: input.conversationId,
      userId: input.userId,
      title: deriveTitle(input.message.parts),
      agentId: getAgentOrDefault(input.agentId).id,
    }));

  // An existing thread keeps the agent it started with: its history was
  // produced by that agent's tools, and replaying it through a different tool
  // set would leave tool calls the new agent does not recognise. The agent is
  // chosen once, when the thread is created.
  const agent = getAgentOrDefault(conversation.agentId);

  const history = await repository.listMessages(conversation.id);

  const [persisted] = await repository.appendMessages(conversation.id, [
    { id: input.message.id, role: "user", parts: input.message.parts },
  ]);

  return {
    conversation,
    agent,
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
  agentId: string;
  agentName: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

function toSummaryDTO(summary: ConversationSummary): ConversationSummaryDTO {
  // Resolved rather than raw: a thread whose agent has since been removed
  // reports the fallback, so every id the client sees matches a live agent.
  const agent = getAgentOrDefault(summary.agentId);

  return {
    id: summary.id,
    title: summary.title,
    agentId: agent.id,
    agentName: agent.name,
    createdAt: summary.createdAt.toISOString(),
    updatedAt: summary.updatedAt.toISOString(),
    messageCount: summary.messageCount,
  };
}

export async function listConversations(
  userId: string,
  limit?: number,
): Promise<ConversationSummaryDTO[]> {
  const summaries = await getChatRepository().listConversations(userId, limit);
  return summaries.map(toSummaryDTO);
}

export async function getConversationWithMessages(id: string, userId: string) {
  const repository = getChatRepository();

  // Not found rather than forbidden when the thread belongs to someone else:
  // a 403 would confirm the id exists.
  const conversation = await repository.getConversation(id, userId);
  if (!conversation) throw new NotFoundError("Conversation");

  const messages = await repository.listMessages(id);
  return {
    conversation: {
      id: conversation.id,
      title: conversation.title,
      agentId: getAgentOrDefault(conversation.agentId).id,
    },
    messages: messages.map(toUIMessage),
  };
}

export async function deleteConversation(
  id: string,
  userId: string,
): Promise<void> {
  const deleted = await getChatRepository().deleteConversation(id, userId);
  if (!deleted) throw new NotFoundError("Conversation");
}
