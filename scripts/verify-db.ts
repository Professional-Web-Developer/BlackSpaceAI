/**
 * Round-trips the chat repository against whatever storage is configured:
 * Postgres when DATABASE_URL is set, the in-memory adapter otherwise.
 *
 *   npm run db:verify
 *
 * Useful after changing the schema or writing a new adapter - it exercises
 * every method of the port, including the cascade delete.
 */
import { randomUUID } from "node:crypto";

import { getChatRepository } from "@/repositories";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function main(): Promise<void> {
  const repository = getChatRepository();
  console.log(`Verifying "${repository.kind}" repository`);

  // Conversations are owned, so the check needs a user to own them. On
  // Postgres the foreign key means this has to be a real row.
  const userId = await createVerificationUser();

  const conversation = await repository.createConversation({
    userId,
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
    costNanos: 1_600_000,
    durationMs: 1234,
  });

  await repository.renameConversation(conversation.id, userId, "Renamed thread");
  const renamed = await repository.getConversation(conversation.id, userId);
  assert(renamed?.title === "Renamed thread", "rename persisted");

  // Another user must not see or touch this thread.
  const otherUserId = randomUUID();
  assert(
    (await repository.getConversation(conversation.id, otherUserId)) === null,
    "another user cannot read the thread",
  );
  assert(
    (await repository.listConversations(otherUserId)).every(
      (item) => item.id !== conversation.id,
    ),
    "another user cannot list the thread",
  );
  assert(
    (await repository.deleteConversation(conversation.id, otherUserId)) ===
      false,
    "another user cannot delete the thread",
  );
  assert(
    (await repository.getConversation(conversation.id, userId)) !== null,
    "the thread survived another user's delete attempt",
  );

  const summaries = await repository.listConversations(userId);
  const summary = summaries.find((item) => item.id === conversation.id);
  assert(summary, "conversation appears in the listing");
  assert(summary.messageCount === 2, "message count is aggregated");

  assert(
    await repository.deleteConversation(conversation.id, userId),
    "delete reported success",
  );
  assert(
    (await repository.getConversation(conversation.id, userId)) === null,
    "conversation is gone",
  );
  assert(
    (await repository.listMessages(conversation.id)).length === 0,
    "messages were removed with the conversation",
  );

  // The verification user is removed too, so repeated runs do not leave a
  // trail of accounts behind in a real database.
  await removeVerificationUser(userId);

  console.log("All repository checks passed");
}

/**
 * The in-memory repository has no users table, so any id works there; on
 * Postgres a real row is required for the foreign key.
 */
async function createVerificationUser(): Promise<string> {
  const { isDatabaseEnabled } = await import("@/config/env");
  if (!isDatabaseEnabled) return randomUUID();

  const { getDatabase, schema } = await import("@/db/client");
  const [user] = await getDatabase()
    .insert(schema.users)
    .values({
      email: `verify-${randomUUID()}@example.invalid`,
      passwordHash: "scrypt$unusable",
    })
    .returning({ id: schema.users.id });

  return user.id;
}

async function removeVerificationUser(userId: string): Promise<void> {
  const { isDatabaseEnabled } = await import("@/config/env");
  if (!isDatabaseEnabled) return;

  const { eq } = await import("drizzle-orm");
  const { getDatabase, schema } = await import("@/db/client");

  await getDatabase().delete(schema.users).where(eq(schema.users.id, userId));
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
