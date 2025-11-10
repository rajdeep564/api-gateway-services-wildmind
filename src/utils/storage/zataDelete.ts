// utils/storage/zataDelete.ts
import { DeleteObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { s3, ZATA_BUCKET } from "./zataClient";

/**
 * Delete a single file from Zata storage
 */
export async function deleteFile(key: string): Promise<boolean> {
  try {
    console.log('[Zata][Delete] Deleting file:', key);
    
    const command = new DeleteObjectCommand({
      Bucket: ZATA_BUCKET,
      Key: key,
    });
    
    await s3.send(command);
    console.log('[Zata][Delete] Successfully deleted:', key);
    return true;
  } catch (error) {
    console.error('[Zata][Delete] Failed to delete file:', key, error);
    return false;
  }
}

/**
 * Delete multiple files from Zata storage
 */
export async function deleteFiles(keys: string[]): Promise<{ deleted: string[]; failed: string[] }> {
  if (keys.length === 0) {
    return { deleted: [], failed: [] };
  }

  try {
    console.log('[Zata][Delete] Deleting files:', keys.length);
    
    const command = new DeleteObjectsCommand({
      Bucket: ZATA_BUCKET,
      Delete: {
        Objects: keys.map(key => ({ Key: key })),
        Quiet: false,
      },
    });
    
    const response = await s3.send(command);
    
    const deleted = response.Deleted?.map(d => d.Key!).filter(Boolean) || [];
    const failed = response.Errors?.map(e => e.Key!).filter(Boolean) || [];
    
    console.log('[Zata][Delete] Batch delete completed:', { deleted: deleted.length, failed: failed.length });
    
    return { deleted, failed };
  } catch (error) {
    console.error('[Zata][Delete] Batch delete failed:', error);
    return { deleted: [], failed: keys };
  }
}

/**
 * Extract storage key from Zata URL
 */
export function extractKeyFromUrl(url: string): string | null {
  try {
    const ZATA_PREFIX = 'https://idr01.zata.ai/devstoragev1/';
    if (url.startsWith(ZATA_PREFIX)) {
      return url.substring(ZATA_PREFIX.length);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Delete all files associated with a generation item (images, videos, thumbnails, optimized versions)
 */
export async function deleteGenerationFiles(item: any): Promise<void> {
  const keysToDelete: string[] = [];

  // Extract keys from images
  if (Array.isArray(item.images)) {
    for (const img of item.images) {
      if (img.url) {
        const key = extractKeyFromUrl(img.url);
        if (key) keysToDelete.push(key);
      }
      if (img.avifUrl) {
        const key = extractKeyFromUrl(img.avifUrl);
        if (key) keysToDelete.push(key);
      }
      if (img.webpUrl) {
        const key = extractKeyFromUrl(img.webpUrl);
        if (key) keysToDelete.push(key);
      }
      if (img.thumbnailUrl) {
        const key = extractKeyFromUrl(img.thumbnailUrl);
        if (key) keysToDelete.push(key);
      }
      if (img.storagePath) {
        keysToDelete.push(img.storagePath);
      }
    }
  }

  // Extract keys from videos
  if (Array.isArray(item.videos)) {
    for (const vid of item.videos) {
      if (vid.url) {
        const key = extractKeyFromUrl(vid.url);
        if (key) keysToDelete.push(key);
      }
      if (vid.thumbnailUrl) {
        const key = extractKeyFromUrl(vid.thumbnailUrl);
        if (key) keysToDelete.push(key);
      }
      if (vid.storagePath) {
        keysToDelete.push(vid.storagePath);
      }
    }
  }

  // Remove duplicates
  const uniqueKeys = [...new Set(keysToDelete)];

  if (uniqueKeys.length > 0) {
    console.log(`[Zata][Delete] Deleting ${uniqueKeys.length} files for generation ${item.id}`);
    await deleteFiles(uniqueKeys);
  }
}
