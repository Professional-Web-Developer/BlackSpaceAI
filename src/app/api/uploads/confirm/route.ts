import { and, eq } from "drizzle-orm";

import { requireUser } from "@/auth/service";
import { getDatabase, schema } from "@/db/client";
import { AppError, NotFoundError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { attachmentIdSchema } from "@/lib/validation";
import { deleteObject, headObject } from "@/storage/s3";

/**
 * Marks an upload as finished, after checking that what landed in the bucket
 * is what was authorised. Rows without this are abandoned transfers and can be
 * swept along with their objects.
 */
export async function POST(request: Request) {
  try {
    const { attachmentId } = await request.json();
    const user = await requireUser();
    const id = attachmentIdSchema.parse(attachmentId);

    const db = getDatabase();

    const [attachment] = await db
      .select()
      .from(schema.attachments)
      .where(
        and(
          eq(schema.attachments.id, id),
          eq(schema.attachments.userId, user.id),
        ),
      )
      .limit(1);

    if (!attachment) throw new NotFoundError("Attachment");

    // Independent of the signature: verify the object matches what this
    // upload was approved for, and bin it if not.
    const object = await headObject(attachment.objectKey);
    if (!object) throw new NotFoundError("Uploaded file");

    const sizeMismatch =
      object.contentLength !== undefined &&
      object.contentLength !== attachment.sizeBytes;
    const typeMismatch =
      object.contentType !== undefined &&
      object.contentType !== attachment.contentType;

    if (sizeMismatch || typeMismatch) {
      logger.warn("Uploaded object does not match what was authorised", {
        attachmentId: id,
        expectedBytes: attachment.sizeBytes,
        actualBytes: object.contentLength,
        expectedType: attachment.contentType,
        actualType: object.contentType,
      });

      await deleteObject(attachment.objectKey);
      await db.delete(schema.attachments).where(eq(schema.attachments.id, id));

      throw new AppError(
        "Uploaded file does not match the approved upload",
        400,
        "upload_mismatch",
      );
    }

    await db
      .update(schema.attachments)
      .set({ uploadedAt: new Date() })
      .where(eq(schema.attachments.id, id));

    return new Response(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
