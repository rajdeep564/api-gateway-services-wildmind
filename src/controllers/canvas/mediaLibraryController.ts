import { Request, Response, NextFunction } from 'express';
import { generationHistoryService } from '../../services/generationHistoryService';
import { formatApiResponse } from '../../utils/formatApiResponse';
import { ImageMedia, VideoMedia } from '../../types/generate';
import { uploadDataUriToZata, uploadFromUrlToZata } from '../../utils/storage/zataUpload';
import { authRepository } from '../../repository/auth/authRepository';
import { generationHistoryRepository } from '../../repository/generationHistoryRepository';

/**
 * Get user's media library (generated images, videos, music, and uploaded media)
 * This endpoint aggregates all media from generation history
 */
export async function getMediaLibrary(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    if (!uid) {
      return res.status(401).json(
        formatApiResponse('error', 'Unauthorized', null)
      );
    }

    // Fetch all image generations (text-to-image, logo, sticker, product, mockup, ad)
    const imageGenerationTypes = [
      'text-to-image',
      'logo',
      'logo-generation',
      'sticker-generation',
      'product-generation',
      'mockup-generation',
      'ad-generation',
      'text-to-character',
    ];

    // Fetch all video generations
    const videoGenerationTypes = [
      'text-to-video',
      'image-to-video',
      'video-to-video',
    ];

    // Fetch image generations with a high limit to get all images
    const imageResult = await generationHistoryService.listUserGenerations(uid, {
      limit: 1000, // Large limit to get all images
      status: 'completed',
      generationType: imageGenerationTypes,
    });

    // Fetch video generations with a high limit to get all videos
    const videoResult = await generationHistoryService.listUserGenerations(uid, {
      limit: 1000, // Large limit to get all videos
      status: 'completed',
      generationType: videoGenerationTypes,
    });

    // Fetch all generations to get uploaded media (inputImages, inputVideos)
    const allGenerationsResult = await generationHistoryService.listUserGenerations(uid, {
      limit: 1000, // Large limit to get all generations
      status: 'completed',
    });

    // Extract images from history entries
    const images: Array<{
      id: string;
      url: string;
      type: 'image';
      thumbnail?: string;
      prompt?: string;
      model?: string;
      createdAt?: string;
      storagePath?: string;
      mediaId?: string;
    }> = [];

    imageResult.items.forEach((item) => {
      if (item.images && Array.isArray(item.images)) {
        item.images.forEach((img: ImageMedia) => {
          images.push({
            id: `${item.id}-${img.id || Date.now()}`,
            url: img.url || img.originalUrl || '',
            type: 'image',
            thumbnail: img.url, // Use main URL as thumbnail
            prompt: item.prompt,
            model: item.model,
            createdAt: item.createdAt?.toString() || new Date().toISOString(),
            storagePath: img.storagePath,
            mediaId: img.id,
          });
        });
      }
    });

    // Extract videos from history entries
    const videos: Array<{
      id: string;
      url: string;
      type: 'video';
      thumbnail?: string;
      prompt?: string;
      model?: string;
      createdAt?: string;
      storagePath?: string;
      mediaId?: string;
    }> = [];

    videoResult.items.forEach((item) => {
      if (item.videos && Array.isArray(item.videos)) {
        item.videos.forEach((video: VideoMedia) => {
          videos.push({
            id: `${item.id}-${video.id || Date.now()}`,
            url: video.url || '',
            type: 'video',
            thumbnail: video.thumbUrl || video.thumbnailUrl || video.url, // Use thumbUrl or url as thumbnail
            prompt: item.prompt,
            model: item.model,
            createdAt: item.createdAt?.toString() || new Date().toISOString(),
            storagePath: video.storagePath,
            mediaId: video.id,
          });
        });
      }
    });

    // Extract uploaded media (inputImages and inputVideos) from all history entries
    const uploaded: Array<{
      id: string;
      url: string;
      type: 'image' | 'video';
      thumbnail?: string;
      prompt?: string;
      model?: string;
      createdAt?: string;
      storagePath?: string;
      mediaId?: string;
    }> = [];

    allGenerationsResult.items.forEach((item) => {
      // Extract inputImages (uploaded images)
      const inputImages = (item as any).inputImages;
      if (inputImages && Array.isArray(inputImages)) {
        inputImages.forEach((img: any) => {
          // Use firebaseUrl if available (for wild project compatibility), otherwise use url
          const mediaUrl = img.firebaseUrl || img.url || img.originalUrl || '';
          uploaded.push({
            id: `${item.id}-input-${img.id || Date.now()}`,
            url: mediaUrl,
            type: 'image',
            thumbnail: img.thumbnailUrl || img.avifUrl || img.firebaseUrl || img.url || img.originalUrl || '',
            prompt: item.prompt,
            model: item.model,
            createdAt: item.createdAt?.toString() || new Date().toISOString(),
            storagePath: img.storagePath,
            mediaId: img.id,
          });
        });
      }

      // Extract inputVideos (uploaded videos)
      const inputVideos = (item as any).inputVideos;
      if (inputVideos && Array.isArray(inputVideos)) {
        inputVideos.forEach((video: any) => {
          // Use firebaseUrl if available (for wild project compatibility), otherwise use url
          const mediaUrl = video.firebaseUrl || video.url || video.originalUrl || '';
          uploaded.push({
            id: `${item.id}-input-video-${video.id || Date.now()}`,
            url: mediaUrl,
            type: 'video',
            thumbnail: video.thumbUrl || video.thumbnailUrl || video.firebaseUrl || video.url || video.originalUrl || '',
            prompt: item.prompt,
            model: item.model,
            createdAt: item.createdAt?.toString() || new Date().toISOString(),
            storagePath: video.storagePath,
            mediaId: video.id,
          });
        });
      }
    });

    // Sort by creation date (newest first)
    images.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });

    videos.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });

    uploaded.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });

    return res.json(
      formatApiResponse('success', 'Media library retrieved', {
        images,
        videos,
        music: [], // TODO: Add music support later
        uploaded,
      })
    );
  } catch (err) {
    console.error('[getMediaLibrary] Error:', err);
    return next(err);
  }
}

/**
 * Save uploaded media from canvas to generation history
 * This allows uploaded files to appear in "My Uploads" in the library
 */
export async function saveUploadedMedia(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    if (!uid) {
      return res.status(401).json(
        formatApiResponse('error', 'Unauthorized', null)
      );
    }

    const { url, type, projectId } = req.body;

    if (!url || !type) {
      return res.status(400).json(
        formatApiResponse('error', 'url and type are required', null)
      );
    }

    if (type !== 'image' && type !== 'video') {
      return res.status(400).json(
        formatApiResponse('error', 'type must be "image" or "video"', null)
      );
    }

    // Get user info
    const creator = await authRepository.getUserById(uid);
    const username = creator?.username || uid;

    // Create a generation history entry for the uploaded file
    const { historyId } = await generationHistoryService.startGeneration(uid, {
      prompt: 'Uploaded from canvas',
      model: 'canvas-upload',
      generationType: type === 'image' ? 'text-to-image' : 'text-to-video',
      visibility: 'private',
    });

    // Upload the file to Zata
    const isDataUri = /^data:/.test(url);
    const keyPrefix = `users/${username}/input/${historyId}`;
    const fileName = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    let stored: { key: string; publicUrl: string; storagePath?: string; originalUrl?: string };
    
    if (isDataUri) {
      const result = await uploadDataUriToZata({
        dataUri: url,
        keyPrefix,
        fileName,
      });
      stored = {
        key: result.key,
        publicUrl: result.publicUrl,
        storagePath: result.key,
        originalUrl: url,
      };
    } else {
      const result = await uploadFromUrlToZata({
        sourceUrl: url,
        keyPrefix,
        fileName,
      });
      stored = {
        key: result.key,
        publicUrl: result.publicUrl,
        storagePath: result.key,
        originalUrl: result.originalUrl,
      };
    }

    // Save to inputImages or inputVideos
    // Match the structure expected by wild project (includes firebaseUrl for compatibility)
    const mediaItem = {
      id: `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      url: stored.publicUrl,
      firebaseUrl: stored.publicUrl, // Wild project expects firebaseUrl
      storagePath: stored.storagePath,
      originalUrl: stored.originalUrl || url,
    };

    // Save inputImages/inputVideos directly to the repository
    // (markGenerationCompleted doesn't handle inputImages/inputVideos)
    const updateData: any = {
      status: 'completed',
    };
    if (type === 'image') {
      updateData.inputImages = [mediaItem];
    } else {
      updateData.inputVideos = [mediaItem];
    }

    // Add canvas project linkage if provided
    if (projectId) {
      updateData.canvasProjectId = projectId;
    }

    // Save directly to repository to ensure inputImages/inputVideos are persisted
    await generationHistoryRepository.update(uid, historyId, updateData);

    // Also call markGenerationCompleted for proper status handling and stats
    await generationHistoryService.markGenerationCompleted(uid, historyId, {
      status: 'completed',
    });

    return res.json(
      formatApiResponse('success', 'Uploaded media saved', {
        id: mediaItem.id,
        url: stored.publicUrl,
        type,
        storagePath: stored.storagePath,
        historyId,
      })
    );
  } catch (err) {
    console.error('[saveUploadedMedia] Error:', err);
    return next(err);
  }
}

