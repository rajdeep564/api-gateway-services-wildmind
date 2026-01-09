
// zataUpload.ts
import axios from 'axios';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { s3, ZATA_BUCKET, makeZataPublicUrl } from './zataClient';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../config/env';

function getInternalGatewayBaseUrl(): string | undefined {
  if (env.apiGatewayUrl) return String(env.apiGatewayUrl).replace(/\/$/, '');
  if (env.devBackendUrl) return String(env.devBackendUrl).replace(/\/$/, '');
  // Production fallback: https://wildmindai.com -> https://api.wildmindai.com
  if (env.productionDomain) {
    return String(env.productionDomain)
      .replace(/^https?:\/\/(?:www\.)?/, 'https://api.')
      .replace(/\/$/, '');
  }
  return undefined;
}

function resolveToAbsoluteUrlIfNeeded(sourceUrl: string): string {
  // Only normalize relative URLs. Absolute http(s) URLs are left untouched.
  if (/^https?:\/\//i.test(sourceUrl)) return sourceUrl;
  // Allow other schemes (e.g. data:) to pass through unchanged; callers should validate.
  if (/^[a-z][a-z0-9+.-]*:/i.test(sourceUrl)) return sourceUrl;

  const base = getInternalGatewayBaseUrl();
  if (!base) {
    throw new Error(
      'Cannot resolve relative URL without API gateway base URL. Set API_GATEWAY_URL (or DEV_BACKEND_URL) so the server can fetch /api/... resources.'
    );
  }

  if (sourceUrl.startsWith('/')) return `${base}${sourceUrl}`;
  return `${base}/${sourceUrl}`;
}

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
    Metadata: {
      'cross-origin-resource-policy': 'cross-origin',
    },
  } as any);
  const out = await (s3 as any).send(cmd as any);
  const publicUrl = makeZataPublicUrl(key);
  return { key, publicUrl, etag: (out as any)?.ETag };
}

export async function uploadStreamToZata(
  key: string,
  body: any,
  contentType: string
): Promise<{ key: string; publicUrl: string; etag?: string }> {
  const cmd = new PutObjectCommand({
    Bucket: ZATA_BUCKET,
    Key: key,
    ContentType: contentType || 'application/octet-stream',
    Body: body,
    Metadata: {
      'cross-origin-resource-policy': 'cross-origin',
    },
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

      // Prefer extracting from the actual object key root (typically starts at 'users/...').
      // NOTE: Many public URLs include a prefix segment like 'devstoragev1' which is NOT part of the S3 key.
      const usersIndex = pathParts.indexOf('users');
      if (usersIndex >= 0) {
        return pathParts.slice(usersIndex).join('/');
      }

      // If there's a storage prefix segment (e.g. devstoragev1/storagev1), skip it.
      const storagePrefixIndex = pathParts.findIndex((p) => /^(?:dev)?storagev\d+$/i.test(p));
      if (storagePrefixIndex >= 0) {
        const afterPrefix = pathParts.slice(storagePrefixIndex + 1);
        return afterPrefix.length > 0 ? afterPrefix.join('/') : null;
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

  // Support internal relative URLs (e.g. /api/proxy/resource/...) by resolving them
  // against the gateway's base URL so we can download and re-upload to Zata.
  const resolvedSourceUrl = resolveToAbsoluteUrlIfNeeded(sourceUrl);

  // Check if sourceUrl is a Zata URL - if so, download directly from S3
  const zataKey = extractKeyFromZataUrl(resolvedSourceUrl);
  let buffer: Buffer;
  let contentType: string | undefined;

  if (zataKey) {
    // Download directly from S3 using credentials (more reliable than HTTP)
    try {
      console.log('[uploadFromUrlToZata] Downloading from Zata using S3:', { zataKey, sourceUrl: resolvedSourceUrl.substring(0, 100) });
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
      const resp = await axios.get<ArrayBuffer>(resolvedSourceUrl, {
        responseType: 'arraybuffer',
        validateStatus: () => true,
      });
      if (resp.status < 200 || resp.status >= 300) {
        throw new Error(`Download failed (${resp.status}) for ${resolvedSourceUrl}`);
      }
      buffer = Buffer.from(resp.data as any);
      contentType = (resp.headers['content-type'] as string) || undefined;
    }
  } else {
    // Regular HTTP download for non-Zata URLs
    const resp = await axios.get<ArrayBuffer>(resolvedSourceUrl, {
      responseType: 'arraybuffer',
      validateStatus: () => true,
    });
    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`Download failed (${resp.status}) for ${resolvedSourceUrl}`);
    }
    buffer = Buffer.from(resp.data as any);
    contentType = (resp.headers['content-type'] as string) || undefined;
  }

  const extFromUrl = (() => {
    try {
      const u = new URL(resolvedSourceUrl);
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