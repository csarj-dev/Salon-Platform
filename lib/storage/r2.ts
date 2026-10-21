import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { isSafeStorageKey } from "../photo-upload";
import { joinPublicUrl } from "./public-url";
import type { Storage } from "./types";

type R2Options = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl: string; // dominio público del bucket
};

export function createR2Storage(o: R2Options): Storage {
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${o.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey },
  });

  function safe(key: string) {
    if (!isSafeStorageKey(key)) throw new Error(`Clave de almacenamiento no válida: ${key}`);
    return key;
  }

  return {
    publicUrl: (key) => joinPublicUrl(o.publicUrl, key),
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: o.bucket, Key: safe(key), Body: body, ContentType: contentType }),
      );
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: o.bucket, Key: safe(key) }));
    },
    createUploadUrl(key, contentType) {
      return getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: o.bucket, Key: safe(key), ContentType: contentType }),
        { expiresIn: 300 }, // 5 minutos
      );
    },
  };
}