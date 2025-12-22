import axios from 'axios';
import FormData from 'form-data';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import * as https from 'https';
// These are available in dependencies; used for local frame extraction fallback
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath = require('ffmpeg-static');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffprobePath = require('ffprobe-static')?.path;
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { ImageMedia, VideoMedia } from '../types/generate';

// Base URL for aesthetic scoring. Must be set via SCORE_LOCAL environment variable.
// Trim trailing slash to ensure consistent request paths.
const AESTHETIC_API_BASE = env.scoreLocal ? env.scoreLocal.replace(/\/$/, '') : undefined;

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
  if (!AESTHETIC_API_BASE) {
    logger.warn('[AestheticScore] SCORE_LOCAL not configured, skipping scoring');
    return null;
  }
  try {
  logger.info({ imageUrl, base: AESTHETIC_API_BASE }, '[AestheticScore] Scoring image');

    // Download the image
    const imageResponse = await fetchWithRetries(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000, // 30s timeout
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
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
          'ngrok-skip-browser-warning': '1',
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
  if (!AESTHETIC_API_BASE) {
    logger.warn('[AestheticScore] SCORE_LOCAL not configured, skipping scoring');
    return null;
  }
  try {
    logger.info({ videoUrl, base: AESTHETIC_API_BASE }, '[AestheticScore] Scoring video');

    // First try: ask scoring service to fetch the URL itself (some deployments accept { url })
    try {
      const jsonResp = await axios.post<VideoScoreResponse>(
        `${AESTHETIC_API_BASE}/score/video`,
        { url: videoUrl },
        {
          headers: {
            'accept': 'application/json',
            'content-type': 'application/json',
            'User-Agent': 'WildMind-Migration/1.0',
            'ngrok-skip-browser-warning': '1',
          },
          validateStatus: () => true,
          timeout: 120000,
        }
      );
      logger.info({ videoUrl, status: jsonResp.status }, '[AestheticScore] URL-submit response');
      if (jsonResp.status === 200 && jsonResp.data) {
        const body = jsonResp.data || {};
        const avg = typeof body.average_score === 'number' ? body.average_score : body.aesthetic_score;
        if (typeof avg === 'number' && !isNaN(avg)) {
          logger.info({ videoUrl, average_score: avg }, '[AestheticScore] Video scored via URL submit');
          return { average_score: avg, frame_scores: body.frame_scores, raw_outputs: body.raw_outputs, frames_sampled: body.frames_sampled };
        }
      }
      // If server returned 403 or other, log and fall through to upload path
      if (jsonResp.status === 403) {
        logger.warn({ videoUrl, status: jsonResp.status, body: jsonResp.data }, '[AestheticScore] URL-submit forbidden, will try direct upload');
      } else if (jsonResp.status !== 200) {
        logger.info({ videoUrl, status: jsonResp.status, body: jsonResp.data }, '[AestheticScore] URL-submit non-200, will try direct upload');
      }
    } catch (e: any) {
      logger.warn({ videoUrl, err: e?.message }, '[AestheticScore] URL-submit attempt failed, will try direct upload');
    }

    // Fallback: download the video and upload the bytes
    const videoResponse = await fetchWithRetries(videoUrl, {
      responseType: 'arraybuffer',
      timeout: 60000, // 60s timeout for larger video files
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: {
        'User-Agent': 'WildMind-Migration/1.0',
      }
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

    // Send to scoring API (multipart upload)
    const scoreResponse = await axios.post<VideoScoreResponse>(
      `${AESTHETIC_API_BASE}/score/video`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'accept': 'application/json',
          'ngrok-skip-browser-warning': '1',
          'User-Agent': 'WildMind-Migration/1.0',
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
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
    return await scoreVideoByFramesFallback(Buffer.from(videoResponse.data), 'video/mp4');
  } catch (error: any) {
    logger.error({ videoUrl, error: error?.message }, '[AestheticScore] Failed to score video');
    try {
      // If we managed to download the video buffer above, fall back to frame sampling
      // Note: if the download failed, videoResponse is undefined; in that case we cannot fallback.
      const resp = await fetchWithRetries(videoUrl, { responseType: 'arraybuffer', timeout: 60000, maxContentLength: Infinity, maxBodyLength: Infinity });
      return await scoreVideoByFramesFallback(Buffer.from(resp.data), resp.headers['content-type'] || 'video/mp4');
    } catch (e: any) {
      logger.error({ videoUrl, error: e?.message }, '[AestheticScore] Fallback frame sampling failed');
      return null;
    }
  }
}

/**
 * Robust fetch helper with retries and exponential backoff.
 * Uses an HTTPS keep-alive agent to improve reliability for many requests.
 */
async function fetchWithRetries(url: string, axiosConfig: any = {}, retries = 3, initialBackoff = 500): Promise<any> {
  const agent = new https.Agent({ keepAlive: true, maxSockets: 10 });
  let attempt = 0;
  while (true) {
    try {
      const res = await axios.get(url, { httpsAgent: agent, ...axiosConfig });
      return res;
    } catch (err: any) {
      attempt += 1;
      if (attempt > retries) throw err;
      const backoff = initialBackoff * Math.pow(2, attempt - 1);
      logger.warn({ url, attempt, err: err?.message }, '[AestheticScore] fetch failed, retrying after backoff');
      await new Promise((r) => setTimeout(r, backoff));
    }
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

// Internal helpers
async function scoreImageBuffer(buffer: Buffer, contentType = 'image/jpeg'): Promise<{ score?: number; raw_output?: any } | null> {
  try {
    const formData = new FormData();
    formData.append('file', buffer, { filename: 'frame.jpg', contentType });
    const res = await axios.post<ImageScoreResponse>(
      `${AESTHETIC_API_BASE}/score/image`,
      formData,
      {
        headers: { ...formData.getHeaders(), accept: 'application/json', 'ngrok-skip-browser-warning': '1' },
        timeout: 60000,
      }
    );
    const body = res.data || {};
    const score = typeof body.score === 'number' ? body.score : body.aesthetic_score;
    if (typeof score === 'number' && !isNaN(score)) return { score, raw_output: body.raw_output };
    return null;
  } catch (e: any) {
    return null;
  }
}

async function scoreVideoByFramesFallback(videoBuffer: Buffer, _contentType: string): Promise<{
  average_score?: number;
  frame_scores?: number[];
  raw_outputs?: any;
  frames_sampled?: number;
} | null> {
  if (!AESTHETIC_API_BASE) {
    logger.warn('[AestheticScore] SCORE_LOCAL not configured, skipping scoring');
    return null;
  }
  // Ensure ffmpeg is available
  if (!ffmpegPath) return null;
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'score-'));
  const videoPath = path.join(tmpDir, 'input.mp4');
  await fs.promises.writeFile(videoPath, videoBuffer);
  let durationSec = 0;
  try {
    if (ffprobePath) {
      const dur = await probeDuration(videoPath);
      durationSec = isFinite(dur) && dur > 0 ? dur : 0;
    }
  } catch {}
  const targetFrames = 8;
  const fps = durationSec > 0 ? Math.max(1, Math.min(6, Math.ceil(targetFrames / durationSec))) : 2;
  const outPattern = path.join(tmpDir, 'frame-%02d.jpg');
  await runFfmpeg(['-y', '-i', videoPath, '-vf', `fps=${fps}`, '-q:v', '2', outPattern]);
  // Read generated frames
  const files = (await fs.promises.readdir(tmpDir)).filter(f => /^frame-\d+\.jpg$/i.test(f)).sort();
  if (files.length === 0) {
    // Cleanup
    try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
    return null;
  }
  const scores: number[] = [];
  for (const f of files) {
    try {
      const buf = await fs.promises.readFile(path.join(tmpDir, f));
      const res = await scoreImageBuffer(buf, 'image/jpeg');
      if (res && typeof res.score === 'number') scores.push(res.score);
    } catch {}
  }
  try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
  if (scores.length === 0) return null;
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return { average_score: avg, frame_scores: scores, frames_sampled: scores.length };
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d?.toString?.() || ''; });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
    });
  });
}

function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    if (!ffprobePath) return resolve(0);
    const args = ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath];
    const child = spawn(ffprobePath, args, { windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d?.toString?.() || ''; });
    child.on('close', () => {
      const n = parseFloat(out.trim());
      resolve(isFinite(n) ? n : 0);
    });
    child.on('error', () => resolve(0));
  });
}
