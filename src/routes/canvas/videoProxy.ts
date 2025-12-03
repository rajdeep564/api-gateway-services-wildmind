/**
 * Backend: Video Proxy Generation Endpoint
 * 
 * Handles video uploads and generates low-resolution proxies for smooth editing.
 * Proxies are used during editing; originals are used for final export.
 */

import express, { Request, Response } from 'express';
import multer from 'multer';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// Configure multer for video uploads
const upload = multer({
    dest: '/tmp/video-uploads',
    limits: {
        fileSize: 500 * 1024 * 1024, // 500MB max
    },
    fileFilter: (req, file, cb) => {
        const allowedMimes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only video files are allowed.'));
        }
    },
});

/**
 * POST /canvas/video/create-proxy
 * 
 * Uploads a video and generates resolution proxies (720p, 1080p)
 */
router.post('/create-proxy', upload.single('video'), async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                responseStatus: 'error',
                message: 'No video file uploaded',
            });
        }

        const { projectId, userId } = req.body;
        const videoId = uuidv4();
        const originalPath = req.file.path;
        const originalFilename = req.file.originalname;

        console.log('[ProxyGeneration] Starting for video:', originalFilename);

        // Get video metadata
        const metadata = await getVideoMetadata(originalPath);
        console.log('[ProxyGeneration] Metadata:', metadata);

        // Upload original to S3
        const originalUrl = await uploadToS3(originalPath, `videos/originals/${userId}/${videoId}/${originalFilename}`);
        console.log('[ProxyGeneration] Original uploaded:', originalUrl);

        // Determine proxy resolutions based on original size
        const proxyResolutions = determineProxyResolutions(metadata.width, metadata.height);
        console.log('[ProxyGeneration] Generating proxies:', proxyResolutions);

        // Generate proxies concurrently
        const proxyPromises = proxyResolutions.map(resolution =>
            generateProxy(originalPath, resolution, videoId, userId)
        );

        const proxies = await Promise.all(proxyPromises);

        // Clean up temp file
        await fs.unlink(originalPath);

        // Return response
        res.json({
            responseStatus: 'success',
            data: {
                videoId,
                originalUrl,
                proxies: proxies.reduce((acc, proxy) => {
                    acc[proxy.resolution] = proxy.url;
                    return acc;
                }, {} as Record<string, string>),
                metadata: {
                    width: metadata.width,
                    height: metadata.height,
                    duration: metadata.duration,
                    codec: metadata.codec,
                    fps: metadata.fps,
                },
            },
        });

    } catch (error) {
        console.error('[ProxyGeneration] Error:', error);
        res.status(500).json({
            responseStatus: 'error',
            message: error instanceof Error ? error.message : 'Failed to generate proxy',
        });
    }
});

/**
 * Get video metadata using ffprobe
 */
async function getVideoMetadata(videoPath: string): Promise<{
    width: number;
    height: number;
    duration: number;
    codec: string;
    fps: number;
}> {
    return new Promise((resolve, reject) => {
        const ffprobe = spawn('ffprobe', [
            '-v', 'quiet',
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            videoPath,
        ]);

        let output = '';
        ffprobe.stdout.on('data', (data) => { output += data; });
        ffprobe.on('close', (code) => {
            if (code !== 0) {
                return reject(new Error('ffprobe failed'));
            }

            try {
                const data = JSON.parse(output);
                const videoStream = data.streams.find((s: any) => s.codec_type === 'video');

                if (!videoStream) {
                    return reject(new Error('No video stream found'));
                }

                const fps = eval(videoStream.r_frame_rate); // e.g., "30000/1001" → 29.97

                resolve({
                    width: videoStream.width,
                    height: videoStream.height,
                    duration: parseFloat(data.format.duration),
                    codec: videoStream.codec_name,
                    fps: Math.round(fps),
                });
            } catch (error) {
                reject(error);
            }
        });
    });
}

/**
 * Determine which proxy resolutions to generate
 */
function determineProxyResolutions(width: number, height: number): string[] {
    const resolutions: string[] = [];

    // Always generate 720p for smooth editing
    if (height > 720) {
        resolutions.push('720p');
    }

    // Generate 1080p if original is higher
    if (height > 1080) {
        resolutions.push('1080p');
    }

    // If original is already low-res, no proxies needed
    if (resolutions.length === 0) {
        console.log('[ProxyGeneration] Original is low-res, skipping proxy generation');
    }

    return resolutions;
}

/**
 * Generate a proxy video at specified resolution
 */
async function generateProxy(
    originalPath: string,
    resolution: string,
    videoId: string,
    userId: string
): Promise<{ resolution: string; url: string }> {
    const outputPath = `/tmp/proxy-${videoId}-${resolution}.mp4`;

    // Determine target height (width will scale proportionally)
    const targetHeight = resolution === '720p' ? 720 : 1080;

    return new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
            '-i', originalPath,
            '-vf', `scale=-2:${targetHeight}`,  // -2 maintains aspect ratio with even width
            '-c:v', 'libx264',
            '-preset', 'fast',  // Fast encoding for quick turnaround
            '-crf', '23',  // Good quality/size balance
            '-c:a', 'aac',
            '-b:a', '128k',
            '-movflags', '+faststart',  // Enable streaming
            '-y',  // Overwrite output
            outputPath,
        ]);

        ffmpeg.stderr.on('data', (data) => {
            // Log progress
            const message = data.toString();
            if (message.includes('time=')) {
                console.log(`[ProxyGeneration] ${resolution}:`, message.trim());
            }
        });

        ffmpeg.on('close', async (code) => {
            if (code !== 0) {
                return reject(new Error(`FFmpeg failed with code ${code}`));
            }

            try {
                // Upload proxy to S3
                const proxyUrl = await uploadToS3(
                    outputPath,
                    `videos/proxies/${userId}/${videoId}/${resolution}.mp4`
                );

                // Clean up temp file
                await fs.unlink(outputPath);

                resolve({ resolution, url: proxyUrl });
            } catch (error) {
                reject(error);
            }
        });
    });
}

/**
 * Upload file to S3 (placeholder - implement based on your S3 setup)
 */
async function uploadToS3(filePath: string, s3Key: string): Promise<string> {
    // TODO: Implement actual S3 upload using @aws-sdk/client-s3
    // For now, return a placeholder URL
    const bucketName = process.env.AWS_S3_BUCKET || 'wildmind-videos';
    return `https://${bucketName}.s3.amazonaws.com/${s3Key}`;
}

export default router;
