/**
 * Round-trips the chat repository against whatever storage is configured:
 * Postgres when DATABASE_URL is set, the in-memory adapter otherwise.
 *
 *   npm run db:verify
 *
 * Useful after changing the schema or writing a new adapter - it exercises
 * every method of the port, including the cascade delete.
 */
import { getChatRepository } from "@/repositories";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function main(): Promise<void> {
  const repository = getChatRepository();
  console.log(`Verifying "${repository.kind}" repository`);

  const conversation = await repository.createConversation({
    title: "Verification thread",
    agentId: "general",
  });
  assert(conversation.id, "conversation received an id");

  await repository.appendMessages(conversation.id, [
    { role: "user", parts: [{ type: "text", text: "What is 2 + 2?" }] },
    { role: "assistant", parts: [{ type: "text", text: "4" }] },
  ]);

  const messages = await repository.listMessages(conversation.id);
  assert(messages.length === 2, `expected 2 messages, got ${messages.length}`);
  assert(messages[0].role === "user", "messages are ordered oldest first");
  assert(
    messages[0].parts[0].type === "text",
    "message parts survived the round trip",
  );

  await repository.recordRun({
    conversationId: conversation.id,
    agentId: "general",
    model: "claude-opus-5",
    steps: 2,
    finishReason: "stop",
    inputTokens: 120,
    outputTokens: 40,
    totalTokens: 160,
    durationMs: 1234,
  });

  await repository.renameConversation(conversation.id, "Renamed thread");
  const renamed = await repository.getConversation(conversation.id);
  assert(renamed?.title === "Renamed thread", "rename persisted");

  const summaries = await repository.listConversations();
  const summary = summaries.find((item) => item.id === conversation.id);
  assert(summary, "conversation appears in the listing");
  assert(summary.messageCount === 2, "message count is aggregated");

  assert(await repository.deleteConversation(conversation.id), "delete reported success");
  assert(
    (await repository.getConversation(conversation.id)) === null,
    "conversation is gone",
  );
  assert(
    (await repository.listMessages(conversation.id)).length === 0,
    "messages were removed with the conversation",
  );

  console.log("All repository checks passed");
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
