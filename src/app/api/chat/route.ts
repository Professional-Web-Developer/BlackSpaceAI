import { propagateAttributes } from "@langfuse/tracing";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";

import { requireUser } from "@/auth/service";
import { env } from "@/config/env";
import { getModel, getProviderOptions } from "@/lib/agent";
import { ConfigurationError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { flushTraces } from "@/lib/observability";
import { chatRequestSchema } from "@/lib/validation";
import { resolveAttachmentUrls } from "@/storage/resolve-attachments";
import { resolveTools } from "@/tools/registry";
import { completeTurn, prepareTurn } from "@/services/chat-service";

// The agent loop makes several sequential model calls; give it room.
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    // Validated before the configuration check, so a malformed request is
    // always a 400 and never masked by a server-side misconfiguration.
    const { conversationId, agentId, message } = chatRequestSchema.parse(
      await request.json(),
    );

    const user = await requireUser();

    if (!env.ANTHROPIC_API_KEY) {
      throw new ConfigurationError(
        "ANTHROPIC_API_KEY is not set. Copy .env.example to .env.local.",
      );
    }

    // History lives in the database, so the client sends only the new message.
    const turn = await prepareTurn({
      conversationId,
      userId: user.id,
      agentId,
      message: message as {
        id: string;
        role: "user";
        parts: UIMessage["parts"];
      },
    });

    const { agent } = turn;

    // Attachments are stored as durable internal references; the model needs
    // fetchable URLs, so they are signed for the length of this turn only.
    const withAttachments = await resolveAttachmentUrls(turn.messages, user.id);
    const modelMessages = await convertToModelMessages(withAttachments);
    const startedAt = Date.now();

    // Everything inside this callback is grouped into one Langfuse trace and
    // attributed to the conversation and the agent that produced it.
    return propagateAttributes(
      {
        sessionId: turn.conversation.id,
        userId: user.id,
        tags: ["chat", `agent:${agent.id}`],
      },
      () => {
        const result = streamText({
          model: getModel(agent),
          system: agent.systemPrompt,
          messages: modelMessages,
          tools: resolveTools(agent.tools),
          stopWhen: stepCountIs(agent.maxSteps),
          providerOptions: getProviderOptions(agent),
          telemetry: { functionId: `agent:${agent.id}` },
        });

        return result.toUIMessageStreamResponse({
          sendReasoning: true,
          sendSources: true,
          originalMessages: turn.messages,
          onFinish: async ({ responseMessage, isAborted }) => {
            try {
              if (!isAborted) {
                const [usage, finishReason, steps] = await Promise.all([
                  result.totalUsage,
                  result.finishReason,
                  result.steps,
                ]);

                await completeTurn({
                  conversationId: turn.conversation.id,
                  assistantMessage: responseMessage,
                  metrics: {
                    agentId: agent.id,
                    model: agent.model,
                    steps: steps.length,
                    finishReason,
                    inputTokens: usage.inputTokens,
                    outputTokens: usage.outputTokens,
                    totalTokens: usage.totalTokens,
                    durationMs: Date.now() - startedAt,
                  },
                });
              }
            } finally {
              // Serverless functions can be frozen the moment the response
              // ends, so batched spans have to be flushed before that.
              await flushTraces();
            }
          },
        });
      },
    );
  } catch (error) {
    logger.error("Chat request failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return toErrorResponse(error);
  }
}
