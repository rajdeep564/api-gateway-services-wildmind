
// zataUpload.ts
import axios from 'axios';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { s3, ZATA_BUCKET, makeZataPublicUrl } from './zataClient';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function guessExtensionFromContentType(contentType: string | undefined, fallback: string = 'bin'): string {
  if (!contentType) return fallback;
  if (contentType.includes('jpeg')) return 'jpg';
  if (contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  if (contentType.includes('mp4')) return 'mp4';
  if (contentType.includes('webm')) return 'webm';
  if (contentType.includes('mpeg')) return 'mp3';
  if (contentType.includes('wav')) return 'wav';
  if (contentType.includes('ogg')) return 'ogg';
  return fallback;
}

export async function uploadBufferToZata(
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<{ key: string; publicUrl: string; etag?: string }> {
  const cmd = new PutObjectCommand({
    Bucket: ZATA_BUCKET,
    Key: key,
    ContentType: contentType || 'application/octet-stream',
    Body: buffer,
  } as any);
  const out = await (s3 as any).send(cmd as any);
  const publicUrl = makeZataPublicUrl(key);
  return { key, publicUrl, etag: (out as any)?.ETag };
}

export async function uploadFromUrlToZata(params: {
  sourceUrl: string;
  keyPrefix: string;
  fileName?: string;
}): Promise<{ key: string; publicUrl: string; etag?: string; originalUrl: string; contentType?: string }> {
  const { sourceUrl, keyPrefix, fileName } = params;
  const resp = await axios.get<ArrayBuffer>(sourceUrl, {
    responseType: 'arraybuffer',
    validateStatus: () => true,
  });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`Download failed (${resp.status}) for ${sourceUrl}`);
  }
  const contentType = (resp.headers['content-type'] as string) || undefined;
  const extFromUrl = (() => {
    try {
      const u = new URL(sourceUrl);
      const path = u.pathname;
      const idx = path.lastIndexOf('.');
      return idx >= 0 ? path.substring(idx + 1).toLowerCase() : undefined;
    } catch {
      return undefined;
    }
  })();
  const ext = extFromUrl || guessExtensionFromContentType(contentType);
  const baseName = fileName || `${Date.now()}`;
  const normalizedPrefix = keyPrefix.replace(/\/$/, '');
  const key = `${normalizedPrefix}/${baseName}.${ext}`;
  const buffer = Buffer.from(resp.data as any);
  const { publicUrl, etag } = await uploadBufferToZata(key, buffer, contentType || 'application/octet-stream');
  return { key, publicUrl, etag, originalUrl: sourceUrl, contentType };
}

export async function getZataSignedGetUrl(key: string, expiresInSeconds: number = 600): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: ZATA_BUCKET, Key: key } as any);
  const url = await getSignedUrl(s3 as any, cmd as any, { expiresIn: expiresInSeconds });
  return url as any;
}