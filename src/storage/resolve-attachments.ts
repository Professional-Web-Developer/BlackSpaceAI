import type { UIMessage, UIMessagePart, UIDataTypes, UITools } from "ai";
import { and, eq, inArray } from "drizzle-orm";

import { getDatabase, schema } from "@/db/client";
import { logger } from "@/lib/logger";

import { isStorageConfigured, presignDownload } from "./s3";

const ATTACHMENT_PATH = "/api/attachments/";

function attachmentIdFrom(url: string): string | undefined {
  return url.startsWith(ATTACHMENT_PATH)
    ? url.slice(ATTACHMENT_PATH.length).split(/[?#]/)[0]
    : undefined;
}

/**
 * Swaps stored attachment references for freshly signed S3 URLs.
 *
 * Message rows hold a durable path (`/api/attachments/<id>`) so a conversation
 * stays valid forever and every read stays authorised. The model cannot use
 * that: it is relative, and it is behind a session cookie. So just before a
 * turn is sent, each reference is resolved to a signed URL with a few minutes
 * of life, which the AI SDK fetches server-side.
 *
 * Lookups are scoped to the acting user, so a message that somehow carries
 * another user's attachment id resolves to nothing and the part is dropped
 * rather than fetched.
 */
export async function resolveAttachmentUrls(
  messages: UIMessage[],
  userId: string,
): Promise<UIMessage[]> {
  const ids = new Set<string>();

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "file") continue;
      const id = attachmentIdFrom(part.url);
      if (id) ids.add(id);
    }
  }

  if (ids.size === 0) return messages;

  if (!isStorageConfigured) {
    logger.warn("Message references attachments but storage is not configured");
    return messages;
  }

  const rows = await getDatabase()
    .select({
      id: schema.attachments.id,
      objectKey: schema.attachments.objectKey,
    })
    .from(schema.attachments)
    .where(
      and(
        inArray(schema.attachments.id, [...ids]),
        eq(schema.attachments.userId, userId),
      ),
    );

  const signed = new Map<string, string>(
    await Promise.all(
      rows.map(
        async (row) =>
          [row.id, await presignDownload(row.objectKey)] as const,
      ),
    ),
  );

  type Part = UIMessagePart<UIDataTypes, UITools>;

  return messages.map((message) => ({
    ...message,
    parts: message.parts.flatMap<Part>((part): Part[] => {
      if (part.type !== "file") return [part];

      const id = attachmentIdFrom(part.url);
      if (!id) return [part];

      const url = signed.get(id);
      if (!url) {
        // Missing, deleted, or not this user's. Dropping it is better than
        // handing the model a URL it cannot fetch, which fails the whole turn.
        logger.warn("Dropping unresolvable attachment from a turn", { id });
        return [];
      }

      return [{ ...part, url }];
    }),
  }));
}
