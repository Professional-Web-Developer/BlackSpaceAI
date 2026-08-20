"use client";

import type { FileUIPart } from "ai";
import { useCallback, useState } from "react";

export type PendingAttachment = {
  id: string;
  filename: string;
  contentType: string;
  /** The durable reference stored on the message, not a signed URL. */
  url: string;
};

type PresignResponse = {
  attachmentId: string;
  uploadUrl: string;
  attachmentUrl: string;
};

/**
 * Uploads files straight to S3 and returns the parts to attach to a message.
 *
 * Three steps per file: ask the server to authorise the upload, PUT the bytes
 * to the signed URL, then confirm. The bytes never touch the app server, so
 * there is no request-body limit to work around and no function timeout on a
 * slow connection.
 */
export function useAttachments(maxMb: number) {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();

  const reset = useCallback(() => {
    setAttachments([]);
    setError(undefined);
  }, []);

  const remove = useCallback((id: string) => {
    setAttachments((current) => current.filter((item) => item.id !== id));
  }, []);

  const upload = useCallback(
    async (files: FileList) => {
      setUploading(true);
      setError(undefined);

      try {
        const uploaded: PendingAttachment[] = [];

        for (const file of files) {
          if (file.size > maxMb * 1024 * 1024) {
            throw new Error(`${file.name} is larger than ${maxMb} MB`);
          }

          const presign = await fetch("/api/uploads/presign", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              filename: file.name,
              contentType: file.type,
              sizeBytes: file.size,
            }),
          });

          if (!presign.ok) {
            const body: { error?: string } = await presign
              .json()
              .catch(() => ({}));
            throw new Error(body.error ?? `Could not upload ${file.name}`);
          }

          const { attachmentId, uploadUrl, attachmentUrl }: PresignResponse =
            await presign.json();

          // The signature covers these headers, so they must match exactly
          // what the server approved or S3 rejects the request.
          const put = await fetch(uploadUrl, {
            method: "PUT",
            headers: {
              "content-type": file.type,
              "content-length": String(file.size),
            },
            body: file,
          });

          if (!put.ok) throw new Error(`Upload of ${file.name} failed`);

          await fetch("/api/uploads/confirm", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ attachmentId }),
          });

          uploaded.push({
            id: attachmentId,
            filename: file.name,
            contentType: file.type,
            url: attachmentUrl,
          });
        }

        setAttachments((current) => [...current, ...uploaded]);
      } catch (uploadError) {
        setError(
          uploadError instanceof Error
            ? uploadError.message
            : "Upload failed",
        );
      } finally {
        setUploading(false);
      }
    },
    [maxMb],
  );

  /** Message parts for the uploaded files. */
  const toFileParts = useCallback(
    (): FileUIPart[] =>
      attachments.map((attachment) => ({
        type: "file",
        mediaType: attachment.contentType,
        filename: attachment.filename,
        url: attachment.url,
      })),
    [attachments],
  );

  return { attachments, uploading, error, upload, remove, reset, toFileParts };
}
