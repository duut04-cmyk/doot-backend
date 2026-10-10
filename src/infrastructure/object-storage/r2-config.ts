import { env } from "../../config/env.js";

export function getR2BucketName(): string {
  return env.R2_BUCKET_NAME ?? "doot";
}

export function getR2Endpoint(): string {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  if (!accountId) {
    throw new Error("R2_ACCOUNT_ID is not configured");
  }
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

export function getR2Credentials(): { accessKeyId: string; secretAccessKey: string } {
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("R2 access credentials are not configured");
  }
  return { accessKeyId, secretAccessKey };
}
