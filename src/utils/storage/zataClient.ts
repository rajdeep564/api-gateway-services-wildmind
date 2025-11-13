// utils/storage/zataClient.ts
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { Agent as HttpsAgent } from "node:https";
import { env } from "../../config/env";

export const ZATA_ENDPOINT = env.zataEndpoint;
export const ZATA_BUCKET = env.zataBucket;
const ZATA_REGION = env.zataRegion;
const ZATA_FORCE_PATH_STYLE = env.zataForcePathStyle;

const ZATA_ACCESS_KEY_ID = env.zataAccessKeyId;
const ZATA_SECRET_ACCESS_KEY = env.zataSecretAccessKey;

const httpsAgent = new HttpsAgent({
  keepAlive: true,
  maxSockets: 64,
  // Prefer IPv4 to avoid AAAA blackholes
  family: 4,
});

export const s3 = new S3Client({
  region: ZATA_REGION,
  endpoint: ZATA_ENDPOINT,
  forcePathStyle: ZATA_FORCE_PATH_STYLE,
  // keep a retry or two for transient network issues; 1 is fine for diagnostics
  maxAttempts: 1,
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 3000,   // time to establish TCP/TLS
    requestTimeout: 8000,      // hard cap for the entire request (THIS is the important one)
    httpsAgent,
  }),
  credentials: {
    accessKeyId: ZATA_ACCESS_KEY_ID,
    secretAccessKey: ZATA_SECRET_ACCESS_KEY,
  },
});

export function makeZataPublicUrl(key: string): string {
  return `${ZATA_ENDPOINT}/${ZATA_BUCKET}/${encodeURI(key)}`;
}

/**
 * Delete a file from Zata storage
 */
export async function deleteFileFromZata(key: string): Promise<void> {
  try {
    const command = new DeleteObjectCommand({
      Bucket: ZATA_BUCKET,
      Key: key,
    });
    await s3.send(command);
  } catch (error: any) {
    console.error(`Failed to delete file from Zata: ${key}`, error);
    throw error;
  }
}
