import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import axios from 'axios';
import ffmpegPath from 'ffmpeg-static';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffprobePath = require('ffprobe-static')?.path;
import { uploadBufferToZata } from '../utils/storage/zataUpload';
import sharp from 'sharp';

/**
 * Generate a thumbnail from a video URL by extracting a frame from the middle of the video
 * @param videoUrl - URL of the video to generate thumbnail from
 * @param keyPrefix - Storage key prefix for the thumbnail (e.g., 'users/username/video/historyId')
 * @param fileName - Optional filename for the thumbnail (default: 'video-1_thumb')
 * @returns Object with thumbnail URL and storage key
 */
export async function generateVideoThumbnail(
  videoUrl: string,
  keyPrefix: string,
  fileName?: string
): Promise<{ key: string; publicUrl: string; thumbnailUrl: string }> {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static is not available');
  }

  // Create temporary directory for processing
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-thumb-'));
  const videoPath = path.join(tmpDir, 'input.mp4');
  const thumbnailPath = path.join(tmpDir, 'thumbnail.jpg');

  try {
    // Download video to temporary file
    const response = await axios.get<ArrayBuffer>(videoUrl, {
      responseType: 'arraybuffer',
      timeout: 30000, // 30 second timeout
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Failed to download video: HTTP ${response.status}`);
    }

    await fs.writeFile(videoPath, Buffer.from(response.data));

    // Get video duration using ffprobe (if available) or estimate from file
    let durationSec = 0;
    try {
      durationSec = await getVideoDuration(videoPath);
    } catch (err) {
      console.warn('[videoThumbnailService] Could not get video duration, using middle estimate:', err);
      // Estimate duration as 5 seconds if we can't determine it
      durationSec = 5;
    }

    // Extract frame from middle of video (or at 1 second if duration is unknown)
    const seekTime = durationSec > 0 ? durationSec / 2 : 1.0;

    // Generate thumbnail using ffmpeg
    await runFfmpeg([
      '-y', // Overwrite output file
      '-ss', String(seekTime), // Seek to middle of video
      '-i', videoPath, // Input video
      '-frames:v', '1', // Extract only 1 frame
      '-vf', 'scale=640:-1:force_original_aspect_ratio=decrease', // Scale to max width 640px, maintain aspect ratio
      '-q:v', '2', // High quality JPEG
      thumbnailPath, // Output path
    ]);

    // Read thumbnail buffer
    const thumbnailBuffer = await fs.readFile(thumbnailPath);

    // Optimize thumbnail with sharp (resize to max 640px width, convert to JPEG)
    const optimizedBuffer = await sharp(thumbnailBuffer)
      .resize(640, null, {
        withoutEnlargement: true,
        fit: 'inside',
      })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();

    // Upload thumbnail to Zata storage
    const baseName = fileName || 'video-1_thumb';
    const normalizedPrefix = keyPrefix.replace(/\/$/, '');
    const key = `${normalizedPrefix}/${baseName}.jpg`;

    const { publicUrl } = await uploadBufferToZata(key, optimizedBuffer, 'image/jpeg');

    return {
      key,
      publicUrl,
      thumbnailUrl: publicUrl,
    };
  } finally {
    // Cleanup temporary files
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (err) {
      console.warn('[videoThumbnailService] Failed to cleanup temp directory:', err);
    }
  }
}

/**
 * Get video duration in seconds using ffprobe
 */
async function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    // Use ffprobe-static if available
    if (!ffprobePath) {
      reject(new Error('ffprobe-static is not available'));
      return;
    }
    
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ];

    const child = spawn(ffprobePath, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      reject(new Error(`ffprobe error: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        const duration = parseFloat(stdout.trim());
        if (isFinite(duration) && duration > 0) {
          resolve(duration);
        } else {
          reject(new Error('Invalid duration from ffprobe'));
        }
      } else {
        reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
      }
    });
  });
}

/**
 * Run ffmpeg command
 */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath as string, args, { windowsHide: true });
    let stderr = '';

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      reject(new Error(`ffmpeg error: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
      }
    });
  });
}

/**
 * Generate thumbnail for a video object and update it with thumbnailUrl
 * @param video - Video object with url, storagePath, etc.
 * @param keyPrefix - Storage key prefix (e.g., 'users/username/video/historyId')
 * @returns Updated video object with thumbnailUrl
 */
export async function generateAndAttachThumbnail(
  video: { url: string; storagePath?: string; id?: string; [key: string]: any },
  keyPrefix: string
): Promise<{ url: string; storagePath?: string; thumbnailUrl: string; [key: string]: any }> {
  try {
    // Skip if thumbnail already exists
    if (video.thumbnailUrl) {
      return video as any;
    }

    // Extract filename from storagePath or use video id
    const fileName = video.storagePath
      ? path.basename(video.storagePath, path.extname(video.storagePath)) + '_thumb'
      : video.id
      ? `${video.id}_thumb`
      : 'video-1_thumb';

    const result = await generateVideoThumbnail(video.url, keyPrefix, fileName);

    return {
      ...video,
      thumbnailUrl: result.thumbnailUrl,
    };
  } catch (error: any) {
    console.error('[videoThumbnailService] Failed to generate thumbnail:', error?.message || error);
    // Return video without thumbnail if generation fails
    return video as any;
  }
}

