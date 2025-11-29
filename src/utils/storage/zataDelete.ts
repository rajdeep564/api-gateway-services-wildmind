// utils/storage/zataDelete.ts
import { DeleteObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { s3, ZATA_BUCKET } from "./zataClient";
import { env } from "../../config/env";

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
    const ZATA_PREFIX = env.zataPrefix;
    if (url.startsWith(ZATA_PREFIX)) {
      return url.substring(ZATA_PREFIX.length);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Delete all files associated with a generation item (images, videos, audio, thumbnails, optimized versions)
 */
export async function deleteGenerationFiles(item: any): Promise<void> {
  const keysToDelete: string[] = [];
  const fileTypes: { images: number; videos: number; audios: number; thumbnails: number; optimized: number } = {
    images: 0,
    videos: 0,
    audios: 0,
    thumbnails: 0,
    optimized: 0,
  };

  console.log(`[Zata][Delete] Starting file deletion for generation ${item.id || 'unknown'}`);

  // Extract keys from images
  if (Array.isArray(item.images)) {
    for (const img of item.images) {
      if (img.url) {
        const key = extractKeyFromUrl(img.url);
        if (key) {
          keysToDelete.push(key);
          fileTypes.images++;
        }
      }
      if (img.avifUrl) {
        const key = extractKeyFromUrl(img.avifUrl);
        if (key) {
          keysToDelete.push(key);
          fileTypes.optimized++;
        }
      }
      if (img.webpUrl) {
        const key = extractKeyFromUrl(img.webpUrl);
        if (key) {
          keysToDelete.push(key);
          fileTypes.optimized++;
        }
      }
      if (img.thumbnailUrl) {
        const key = extractKeyFromUrl(img.thumbnailUrl);
        if (key) {
          keysToDelete.push(key);
          fileTypes.thumbnails++;
        }
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
        if (key) {
          keysToDelete.push(key);
          fileTypes.videos++;
        }
      }
      if (vid.thumbnailUrl) {
        const key = extractKeyFromUrl(vid.thumbnailUrl);
        if (key) {
          keysToDelete.push(key);
          fileTypes.thumbnails++;
        }
      }
      if (vid.storagePath) {
        keysToDelete.push(vid.storagePath);
      }
    }
  }

  // Extract keys from audio files
  if (Array.isArray(item.audios)) {
    for (const audio of item.audios) {
      if (audio.url) {
        const key = extractKeyFromUrl(audio.url);
        if (key) {
          keysToDelete.push(key);
          fileTypes.audios++;
        }
      }
      if (audio.storagePath) {
        keysToDelete.push(audio.storagePath);
      }
      // Audio might have thumbnail/preview images
      if (audio.thumbnailUrl) {
        const key = extractKeyFromUrl(audio.thumbnailUrl);
        if (key) {
          keysToDelete.push(key);
          fileTypes.thumbnails++;
        }
      }
    }
  }

  // Remove duplicates
  const uniqueKeys = [...new Set(keysToDelete)];

  if (uniqueKeys.length > 0) {
    console.log(`[Zata][Delete] Deleting ${uniqueKeys.length} files for generation ${item.id || 'unknown'}:`, fileTypes);
    console.log(`[Zata][Delete] File keys (first 10):`, uniqueKeys.slice(0, 10));
    
    const result = await deleteFiles(uniqueKeys);
    
    console.log(`[Zata][Delete] Deletion result:`, {
      totalRequested: uniqueKeys.length,
      deleted: result.deleted.length,
      failed: result.failed.length,
      success: result.failed.length === 0,
    });
    
    if (result.failed.length > 0) {
      console.warn(`[Zata][Delete] Failed to delete ${result.failed.length} files:`, result.failed.slice(0, 5));
    }
  } else {
    console.log(`[Zata][Delete] No files to delete for generation ${item.id || 'unknown'}`);
  }
}
