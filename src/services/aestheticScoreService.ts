import axios from 'axios';
import FormData from 'form-data';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { ImageMedia, VideoMedia } from '../types/generate';

// Base URL for aesthetic scoring. Prefer SCORE_LOCAL from environment, fallback to previous hardcoded value.
// Trim trailing slash to ensure consistent request paths.
const AESTHETIC_API_BASE = (env.scoreLocal || 'https://0faa6933d5e8.ngrok-free.app').replace(/\/$/, '');

// API response shapes (new unified format with backward compatibility)
interface ImageScoreResponse {
  score?: number; // preferred new field
  raw_output?: any;
  aesthetic_score?: number; // legacy fallback
}

interface VideoScoreResponse {
  average_score?: number; // preferred for videos
  frame_scores?: number[];
  raw_outputs?: any;
  frames_sampled?: number;
  aesthetic_score?: number; // legacy fallback (single number)
}

/**
 * Score a single image by URL
 * Downloads the image and sends it to the aesthetic scoring API
 */
async function scoreImage(imageUrl: string): Promise<{ score?: number; raw_output?: any } | null> {
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
    const scoreResponse = await axios.post<ImageScoreResponse>(
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

    const body = scoreResponse.data || {};
    const score = typeof body.score === 'number' ? body.score : body.aesthetic_score;
    if (typeof score === 'number' && !isNaN(score)) {
      logger.info({ imageUrl, score }, '[AestheticScore] Image scored successfully');
      return { score, raw_output: body.raw_output };
    }

    logger.warn({ imageUrl, response: body }, '[AestheticScore] Invalid score response');
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
async function scoreVideo(videoUrl: string): Promise<{
  average_score?: number;
  frame_scores?: number[];
  raw_outputs?: any;
  frames_sampled?: number;
} | null> {
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
    const scoreResponse = await axios.post<VideoScoreResponse>(
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

    const body = scoreResponse.data || {};
    const avg = typeof body.average_score === 'number' ? body.average_score : body.aesthetic_score;
    if (typeof avg === 'number' && !isNaN(avg)) {
      logger.info({ videoUrl, average_score: avg, frames: Array.isArray(body.frame_scores) ? body.frame_scores.length : 0 }, '[AestheticScore] Video scored successfully');
      return { average_score: avg, frame_scores: body.frame_scores, raw_outputs: body.raw_outputs, frames_sampled: body.frames_sampled };
    }

    logger.warn({ videoUrl, response: body }, '[AestheticScore] Invalid score response');
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
      const result = await scoreImage(img.url);
      if (result) {
        return {
          ...img,
          aestheticScore: typeof result.score === 'number' ? result.score : img.aestheticScore,
          aesthetic: { score: result.score, raw_output: result.raw_output },
        };
      }
      return img;
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
      const result = await scoreVideo(vid.url);
      if (result) {
        const avg = result.average_score;
        return {
          ...vid,
          aestheticScore: typeof avg === 'number' ? avg : vid.aestheticScore,
          aesthetic: {
            average_score: result.average_score,
            frame_scores: result.frame_scores,
            raw_outputs: result.raw_outputs,
            frames_sampled: result.frames_sampled,
          },
        };
      }
      return vid;
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
function getHighestScore(assets: Array<{ aestheticScore?: number; aesthetic?: any }>): number | undefined {
  const scores = assets
    .map(a => (typeof a.aestheticScore === 'number' ? a.aestheticScore : (a as any)?.aesthetic?.score || (a as any)?.aesthetic?.average_score))
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
