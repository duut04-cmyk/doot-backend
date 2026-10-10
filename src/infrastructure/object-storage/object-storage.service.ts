import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env, isObjectStorageConfigured } from "../../config/env.js";
import { getR2BucketName, getR2Credentials, getR2Endpoint } from "./r2-config.js";

const PRESIGNED_READ_EXPIRY_SECONDS = 3600;

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  const { accessKeyId, secretAccessKey } = getR2Credentials();
  if (!s3Client) {
    s3Client = new S3Client({
      region: "auto",
      endpoint: getR2Endpoint(),
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
  }
  return s3Client;
}

export class ObjectStorageService {
  /** Public CDN/base URL, or short-lived signed URL when R2 credentials are configured. */
  async resolveObjectReadUrl(objectKey: string): Promise<string | null> {
    const publicBase = env.R2_PUBLIC_BASE_URL?.trim().replace(/\/$/, "");
    if (publicBase) {
      return `${publicBase}/${objectKey}`;
    }

    if (!isObjectStorageConfigured()) {
      return null;
    }

    const client = getS3Client();
    const command = new GetObjectCommand({
      Bucket: getR2BucketName(),
      Key: objectKey,
    });
    return getSignedUrl(client, command, {
      expiresIn: PRESIGNED_READ_EXPIRY_SECONDS,
    });
  }
}

export const objectStorageService = new ObjectStorageService();
