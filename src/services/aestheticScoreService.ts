import axios from 'axios';
import FormData from 'form-data';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { ImageMedia, VideoMedia } from '../types/generate';

// Base URL for aesthetic scoring. Prefer SCORE_LOCAL from environment, fallback to previous hardcoded value.
// Trim trailing slash to ensure consistent request paths.
const AESTHETIC_API_BASE = (env.scoreLocal || 'https://0faa6933d5e8.ngrok-free.app').replace(/\/$/, '');

interface AestheticScoreResponse {
  aesthetic_score: number;
}

/**
 * Score a single image by URL
 * Downloads the image and sends it to the aesthetic scoring API
 */
async function scoreImage(imageUrl: string): Promise<number | null> {
  try {
  logger.info({ imageUrl, base: AESTHETIC_API_BASE }, '[AestheticScore] Scoring image');

    // Download the image
    const imageResponse = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000, // 30s timeout
    });

    if (!imageResponse.data) {
      logger.warn({ imageUrl }, '[AestheticScore] No image data downloaded');
      return null;
    }

    // Create form data with the image
    const formData = new FormData();
    formData.append('file', Buffer.from(imageResponse.data), {
      filename: 'image.jpg',
      contentType: imageResponse.headers['content-type'] || 'image/jpeg',
    });

    // Send to scoring API
    const scoreResponse = await axios.post<AestheticScoreResponse>(
      `${AESTHETIC_API_BASE}/score/image`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'accept': 'application/json',
        },
        timeout: 60000, // 60s timeout for scoring
      }
    );

    const score = scoreResponse.data?.aesthetic_score;
    if (typeof score === 'number' && !isNaN(score)) {
      logger.info({ imageUrl, score }, '[AestheticScore] Image scored successfully');
      return score;
    }

    logger.warn({ imageUrl, response: scoreResponse.data }, '[AestheticScore] Invalid score response');
    return null;
  } catch (error: any) {
    logger.error({ imageUrl, error: error?.message }, '[AestheticScore] Failed to score image');
    return null;
  }
}

/**
 * Score a single video by URL
 * Downloads the video and sends it to the aesthetic scoring API
 */
async function scoreVideo(videoUrl: string): Promise<number | null> {
  try {
  logger.info({ videoUrl, base: AESTHETIC_API_BASE }, '[AestheticScore] Scoring video');

    // Download the video
    const videoResponse = await axios.get(videoUrl, {
      responseType: 'arraybuffer',
      timeout: 60000, // 60s timeout for larger video files
    });

    if (!videoResponse.data) {
      logger.warn({ videoUrl }, '[AestheticScore] No video data downloaded');
      return null;
    }

    // Create form data with the video
    const formData = new FormData();
    formData.append('file', Buffer.from(videoResponse.data), {
      filename: 'video.mp4',
      contentType: videoResponse.headers['content-type'] || 'video/mp4',
    });

    // Send to scoring API
    const scoreResponse = await axios.post<AestheticScoreResponse>(
      `${AESTHETIC_API_BASE}/score/video`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'accept': 'application/json',
        },
        timeout: 120000, // 120s timeout for video scoring (takes longer)
      }
    );

    const score = scoreResponse.data?.aesthetic_score;
    if (typeof score === 'number' && !isNaN(score)) {
      logger.info({ videoUrl, score }, '[AestheticScore] Video scored successfully');
      return score;
    }

    logger.warn({ videoUrl, response: scoreResponse.data }, '[AestheticScore] Invalid score response');
    return null;
  } catch (error: any) {
    logger.error({ videoUrl, error: error?.message }, '[AestheticScore] Failed to score video');
    return null;
  }
}

/**
 * Score multiple images in parallel and attach scores to each image object
 * Returns the images array with aestheticScore added to each
 */
async function scoreImages(images: ImageMedia[]): Promise<ImageMedia[]> {
  if (!images || images.length === 0) return [];

  try {
    const scoringPromises = images.map(async (img) => {
      const score = await scoreImage(img.url);
      return {
        ...img,
        aestheticScore: score !== null ? score : undefined,
      };
    });

    const scoredImages = await Promise.all(scoringPromises);
    return scoredImages;
  } catch (error: any) {
    logger.error({ error: error?.message }, '[AestheticScore] Failed to score images batch');
    return images; // Return original images without scores on error
  }
}

/**
 * Score multiple videos in parallel and attach scores to each video object
 * Returns the videos array with aestheticScore added to each
 */
async function scoreVideos(videos: VideoMedia[]): Promise<VideoMedia[]> {
  if (!videos || videos.length === 0) return [];

  try {
    const scoringPromises = videos.map(async (vid) => {
      const score = await scoreVideo(vid.url);
      return {
        ...vid,
        aestheticScore: score !== null ? score : undefined,
      };
    });

    const scoredVideos = await Promise.all(scoringPromises);
    return scoredVideos;
  } catch (error: any) {
    logger.error({ error: error?.message }, '[AestheticScore] Failed to score videos batch');
    return videos; // Return original videos without scores on error
  }
}

/**
 * Calculate the highest aesthetic score from a set of scored assets
 */
function getHighestScore(assets: Array<{ aestheticScore?: number }>): number | undefined {
  const scores = assets
    .map(a => a.aestheticScore)
    .filter((s): s is number => typeof s === 'number' && !isNaN(s));
  
  if (scores.length === 0) return undefined;
  return Math.max(...scores);
}

export const aestheticScoreService = {
  scoreImage,
  scoreVideo,
  scoreImages,
  scoreVideos,
  getHighestScore,
};
