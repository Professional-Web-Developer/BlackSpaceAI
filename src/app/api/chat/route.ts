import { propagateAttributes } from "@langfuse/tracing";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";

import { env } from "@/config/env";
import { MAX_STEPS, MODEL_ID, SYSTEM_PROMPT, model, providerOptions } from "@/lib/agent";
import { ConfigurationError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { flushTraces } from "@/lib/observability";
import { tools } from "@/lib/tools";
import { chatRequestSchema } from "@/lib/validation";
import { completeTurn, prepareTurn } from "@/services/chat-service";

// The agent loop makes several sequential model calls; give it room.
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    // Validated before the configuration check, so a malformed request is
    // always a 400 and never masked by a server-side misconfiguration.
    const { conversationId, message } = chatRequestSchema.parse(
      await request.json(),
    );

    if (!env.ANTHROPIC_API_KEY) {
      throw new ConfigurationError(
        "ANTHROPIC_API_KEY is not set. Copy .env.example to .env.local.",
      );
    }

    // History lives in the database, so the client sends only the new message.
    const turn = await prepareTurn({
      conversationId,
      message: message as { id: string; role: "user"; parts: UIMessage["parts"] },
    });

    const modelMessages = await convertToModelMessages(turn.messages);
    const startedAt = Date.now();

    // Everything inside this callback is grouped into one Langfuse trace and
    // attributed to the conversation it belongs to.
    return propagateAttributes(
      { sessionId: turn.conversation.id, tags: ["chat"] },
      () => {
        const result = streamText({
          model,
          system: SYSTEM_PROMPT,
          messages: modelMessages,
          tools,
          stopWhen: stepCountIs(MAX_STEPS),
          providerOptions,
          telemetry: { functionId: "agentic-chat" },
        });

        return result.toUIMessageStreamResponse({
          sendReasoning: true,
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
                    model: MODEL_ID,
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
