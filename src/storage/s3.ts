import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "@/config/env";
import { ConfigurationError } from "@/lib/errors";

/**
 * Attachment storage on S3.
 *
 * The browser uploads straight to S3 with a presigned PUT, so file bytes never
 * pass through this server: no request-body limit to work around, no memory
 * spent proxying, and no serverless timeout on a slow upload.
 */

/** Uploads are short-lived; the browser starts immediately. */
const PUT_EXPIRY_SECONDS = 5 * 60;
/**
 * Reads are signed just before use. Message rows store an internal reference
 * rather than a signed URL, so a stored conversation never contains a link
 * that expires or that works without a session.
 */
const GET_EXPIRY_SECONDS = 10 * 60;

let cached: S3Client | undefined;

export const isStorageConfigured = Boolean(env.S3_BUCKET && env.AWS_REGION);

function client(): S3Client {
  if (!isStorageConfigured) {
    throw new ConfigurationError(
      "Attachment storage is not configured. Set AWS_REGION and S3_BUCKET.",
    );
  }

  cached ??= new S3Client({
    region: env.AWS_REGION,
    // Only set when both are present; otherwise the SDK's default chain finds
    // an instance role, a shared profile, or a web identity token.
    ...(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
          },
        }
      : {}),
    // A custom endpoint covers S3-compatible stores (R2, MinIO) and local
    // testing. Those need path-style addressing.
    ...(env.S3_ENDPOINT
      ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true }
      : {}),
  });

  return cached;
}

/**
 * Object keys are namespaced by user, so a bucket policy or lifecycle rule can
 * be written per user, and a leaked key cannot be walked to another user's
 * files.
 */
export function buildObjectKey(userId: string, attachmentId: string): string {
  return `attachments/${userId}/${attachmentId}`;
}

export async function presignUpload(input: {
  key: string;
  contentType: string;
  contentLength: number;
}): Promise<string> {
  // ContentType and ContentLength are signed, so the browser cannot upload a
  // different type or a larger file than the server approved - the signature
  // simply will not match.
  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: input.key,
    ContentType: input.contentType,
    ContentLength: input.contentLength,
  });

  return getSignedUrl(client(), command, {
    expiresIn: PUT_EXPIRY_SECONDS,
    signableHeaders: new Set(["content-type", "content-length"]),
  });
}

export async function presignDownload(key: string): Promise<string> {
  return getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
    { expiresIn: GET_EXPIRY_SECONDS },
  );
}

/**
 * What actually landed in the bucket.
 *
 * The presigned PUT signs content type and length, so S3 should already reject
 * a mismatch - but that is one control, enforced by a service this code cannot
 * see. Checking the stored object independently means a client that somehow
 * uploads something other than what was authorised is still caught here.
 */
export async function headObject(key: string): Promise<{
  contentType: string | undefined;
  contentLength: number | undefined;
} | null> {
  try {
    const result = await client().send(
      new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
    );
    return {
      contentType: result.ContentType,
      contentLength: result.ContentLength,
    };
  } catch {
    // Missing object, or no permission to read it back.
    return null;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await client().send(
    new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
  );
}
