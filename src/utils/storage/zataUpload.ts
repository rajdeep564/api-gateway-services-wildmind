
// zataUpload.ts
import axios from 'axios';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { s3, ZATA_BUCKET, makeZataPublicUrl } from './zataClient';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../config/env';

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

/**
 * Extract storage key from Zata URL
 */
function extractKeyFromZataUrl(url: string): string | null {
  try {
    // Check if it's a Zata URL (idr01.zata.ai or similar)
    if (url.includes('zata.ai') || url.includes('zata')) {
      // Extract key from URL pattern: https://idr01.zata.ai/devstoragev1/users/username/path/to/file.jpg
      // Or: https://endpoint/bucket/users/username/path/to/file.jpg
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(p => p);
      
      // Find the index of 'users' or 'devstoragev1' to extract the key
      let keyStartIndex = -1;
      for (let i = 0; i < pathParts.length; i++) {
        if (pathParts[i] === 'users' || pathParts[i] === 'devstoragev1') {
          keyStartIndex = i;
          break;
        }
      }
      
      if (keyStartIndex >= 0) {
        // Extract everything after 'users' or 'devstoragev1'
        const keyParts = pathParts.slice(keyStartIndex);
        return keyParts.join('/');
      }
      
      // Fallback: try to extract from pathname (skip bucket name if present)
      // Pattern: /bucket/key or /key
      if (pathParts.length > 1 && pathParts[0] === ZATA_BUCKET) {
        return pathParts.slice(1).join('/');
      } else if (pathParts.length > 0) {
        return pathParts.join('/');
      }
    }
    
    // Try using zataPrefix if available
    const ZATA_PREFIX = (env as any).zataPrefix;
    if (ZATA_PREFIX && url.startsWith(ZATA_PREFIX)) {
      return url.substring(ZATA_PREFIX.length);
    }
    
    return null;
  } catch {
    return null;
  }
}

export async function uploadFromUrlToZata(params: {
  sourceUrl: string;
  keyPrefix: string;
  fileName?: string;
}): Promise<{ key: string; publicUrl: string; etag?: string; originalUrl: string; contentType?: string }> {
  const { sourceUrl, keyPrefix, fileName } = params;
  
  // Check if sourceUrl is a Zata URL - if so, download directly from S3
  const zataKey = extractKeyFromZataUrl(sourceUrl);
  let buffer: Buffer;
  let contentType: string | undefined;
  
  if (zataKey) {
    // Download directly from S3 using credentials (more reliable than HTTP)
    try {
      console.log('[uploadFromUrlToZata] Downloading from Zata using S3:', { zataKey, sourceUrl: sourceUrl.substring(0, 100) });
      const getCmd = new GetObjectCommand({
        Bucket: ZATA_BUCKET,
        Key: zataKey,
      });
      const response = await s3.send(getCmd);
      const chunks: Uint8Array[] = [];
      
      // Stream the response body
      if (response.Body) {
        for await (const chunk of response.Body as any) {
          chunks.push(chunk);
        }
        buffer = Buffer.concat(chunks);
        contentType = (response.ContentType as string) || undefined;
        console.log('[uploadFromUrlToZata] Successfully downloaded from Zata:', { size: buffer.length, contentType });
      } else {
        throw new Error('No body in S3 response');
      }
    } catch (s3Error: any) {
      console.warn('[uploadFromUrlToZata] Failed to download from Zata via S3, trying HTTP fallback:', s3Error?.message);
      // Fallback to HTTP download
      const resp = await axios.get<ArrayBuffer>(sourceUrl, {
        responseType: 'arraybuffer',
        validateStatus: () => true,
      });
      if (resp.status < 200 || resp.status >= 300) {
        throw new Error(`Download failed (${resp.status}) for ${sourceUrl}`);
      }
      buffer = Buffer.from(resp.data as any);
      contentType = (resp.headers['content-type'] as string) || undefined;
    }
  } else {
    // Regular HTTP download for non-Zata URLs
    const resp = await axios.get<ArrayBuffer>(sourceUrl, {
      responseType: 'arraybuffer',
      validateStatus: () => true,
    });
    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`Download failed (${resp.status}) for ${sourceUrl}`);
    }
    buffer = Buffer.from(resp.data as any);
    contentType = (resp.headers['content-type'] as string) || undefined;
  }
  
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
  const { publicUrl, etag } = await uploadBufferToZata(key, buffer, contentType || 'application/octet-stream');
  return { key, publicUrl, etag, originalUrl: sourceUrl, contentType };
}

export async function getZataSignedGetUrl(key: string, expiresInSeconds: number = 600): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: ZATA_BUCKET, Key: key } as any);
  const url = await getSignedUrl(s3 as any, cmd as any, { expiresIn: expiresInSeconds });
  return url as any;
}

export async function uploadDataUriToZata(params: {
  dataUri: string;
  keyPrefix: string;
  fileName?: string;
}): Promise<{ key: string; publicUrl: string; etag?: string; contentType?: string }> {
  const { dataUri, keyPrefix, fileName } = params;
  // data:[mime];base64,xxxxx
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUri);
  if (!match) throw new Error('Invalid data URI');
  const contentType = match[1];
  const base64 = match[2];
  const buffer = Buffer.from(base64, 'base64');
  const ext = guessExtensionFromContentType(contentType);
  const baseName = fileName || `${Date.now()}`;
  const normalizedPrefix = keyPrefix.replace(/\/$/, '');
  const key = `${normalizedPrefix}/${baseName}.${ext}`;
  const { publicUrl, etag } = await uploadBufferToZata(key, buffer, contentType || 'application/octet-stream');
  return { key, publicUrl, etag, contentType };
}