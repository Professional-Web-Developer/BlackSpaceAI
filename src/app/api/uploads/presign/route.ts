import { eq } from "drizzle-orm";

import { requireUser } from "@/auth/service";
import { env } from "@/config/env";
import { getDatabase, schema } from "@/db/client";
import { AppError, ConfigurationError, toErrorResponse } from "@/lib/errors";
import { presignUploadSchema } from "@/lib/validation";
import { buildObjectKey, isStorageConfigured, presignUpload } from "@/storage/s3";

/**
 * Authorises one direct-to-S3 upload.
 *
 * The bytes never reach this server: the browser PUTs them to the signed URL.
 * The signature covers the content type and length, so the client cannot
 * upload something larger or of a different type than was approved here.
 */
export async function POST(request: Request) {
  try {
    const input = presignUploadSchema.parse(await request.json());
    const user = await requireUser();

    if (!isStorageConfigured) {
      throw new ConfigurationError(
        "Attachment storage is not configured. Set AWS_REGION and S3_BUCKET.",
      );
    }

    const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
    if (input.sizeBytes > maxBytes) {
      throw new AppError(
        `Files must be under ${env.MAX_UPLOAD_MB} MB`,
        413,
        "file_too_large",
      );
    }

    // The row is created before the upload so the key is recorded even if the
    // browser dies mid-transfer; `uploadedAt` stays null and it can be swept.
    const [attachment] = await getDatabase()
      .insert(schema.attachments)
      .values({
        userId: user.id,
        objectKey: "",
        filename: input.filename,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
      })
      .returning({ id: schema.attachments.id });

    const objectKey = buildObjectKey(user.id, attachment.id);
    await getDatabase()
      .update(schema.attachments)
      .set({ objectKey })
      .where(eq(schema.attachments.id, attachment.id));

    return Response.json({
      attachmentId: attachment.id,
      uploadUrl: await presignUpload({
        key: objectKey,
        contentType: input.contentType,
        contentLength: input.sizeBytes,
      }),
      // What the message part carries. Durable and authorised, unlike a signed
      // URL, which would expire inside a stored conversation.
      attachmentUrl: `/api/attachments/${attachment.id}`,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
