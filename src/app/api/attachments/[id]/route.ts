import { and, eq } from "drizzle-orm";

import { requireUser } from "@/auth/service";
import { getDatabase, schema } from "@/db/client";
import { NotFoundError, toErrorResponse } from "@/lib/errors";
import { attachmentIdSchema } from "@/lib/validation";
import { presignDownload } from "@/storage/s3";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Redirects to a freshly signed URL for the object.
 *
 * Message rows store this stable path rather than a signed URL, so a stored
 * conversation never contains a link that expires - or one that would still
 * work for anyone who found it. Every read is authorised here first.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = await requireUser();

    const [attachment] = await getDatabase()
      .select({ objectKey: schema.attachments.objectKey })
      .from(schema.attachments)
      .where(
        and(
          eq(schema.attachments.id, attachmentIdSchema.parse(id)),
          // Scoped by owner: someone else's id is a 404, not a 403, which
          // would confirm the attachment exists.
          eq(schema.attachments.userId, user.id),
        ),
      )
      .limit(1);

    if (!attachment?.objectKey) throw new NotFoundError("Attachment");

    return Response.redirect(await presignDownload(attachment.objectKey), 307);
  } catch (error) {
    return toErrorResponse(error);
  }
}
