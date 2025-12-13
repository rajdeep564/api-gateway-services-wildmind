// ============================================
// Video Export Routes
// API endpoints for server-side video export
// ============================================

import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { videoExportService } from '../services/videoExportService';
import type { StartExportRequest } from '../types/videoExport';

const router = Router();

// Log when routes are loaded
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🎬 VIDEO EXPORT ROUTES LOADED');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const jobId = req.params.jobId;
        const jobDir = videoExportService.getJobDir(jobId);
        cb(null, jobDir);
    },
    filename: (req, file, cb) => {
        // Extract extension first
        let ext = path.extname(file.originalname) || '';

        // If no valid extension, determine from MIME type
        if (!ext || ext === '.' || ext.length < 2) {
            const mimeToExt: Record<string, string> = {
                'video/mp4': '.mp4',
                'video/webm': '.webm',
                'video/quicktime': '.mov',
                'video/x-msvideo': '.avi',
                'video/x-matroska': '.mkv',
                'image/jpeg': '.jpg',
                'image/png': '.png',
                'image/gif': '.gif',
                'image/webp': '.webp',
                'audio/mpeg': '.mp3',
                'audio/wav': '.wav',
                'audio/ogg': '.ogg',
                'audio/aac': '.aac',
            };
            ext = mimeToExt[file.mimetype] || (file.mimetype?.startsWith('video/') ? '.mp4' :
                file.mimetype?.startsWith('image/') ? '.jpg' :
                    file.mimetype?.startsWith('audio/') ? '.mp3' : '.bin');
            console.log(`[Upload] No extension detected for ${file.originalname}, using ${ext} based on MIME: ${file.mimetype}`);
        }

        const nameWithoutExt = path.basename(file.originalname, path.extname(file.originalname));

        // Sanitize filename - remove Windows-invalid characters: \ / : * ? " < > |
        const sanitizedName = nameWithoutExt
            .replace(/[\\/:*?"<>|]/g, '_')  // Replace invalid chars with underscore
            .replace(/\s+/g, '_')           // Replace spaces with underscore
            .replace(/_+/g, '_')            // Collapse multiple underscores
            .replace(/\.+$/, '')            // Remove trailing dots
            .substring(0, 80);              // Limit base name to 80 chars (leaving room for timestamp + ext)

        const uniqueName = `${Date.now()}-${sanitizedName}${ext}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 500 * 1024 * 1024 } // 500MB limit per file
});

/**
 * POST /api/video-export/start
 * Start a new export job
 */
router.post('/start', async (req: Request, res: Response) => {
    try {
        const userId = (req as any).userId || 'anonymous';

        const job = await videoExportService.createJob(userId);

        console.log(`[VideoExport] Started job ${job.id}`);

        res.json({
            success: true,
            jobId: job.id,
            message: 'Export job created. Upload assets and then call /process'
        });
    } catch (error) {
        console.error('[VideoExport] Error starting job:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to start export job'
        });
    }
});

/**
 * POST /api/video-export/upload/:jobId
 * Upload assets for an export job
 */
router.post('/upload/:jobId', upload.array('files', 50), async (req: Request, res: Response) => {
    try {
        const { jobId } = req.params;
        const files = req.files as Express.Multer.File[];

        const job = videoExportService.getJob(jobId);
        if (!job) {
            return res.status(404).json({ success: false, error: 'Job not found' });
        }

        const uploadedFiles = files.map(f => ({
            originalName: f.originalname,
            localPath: f.path,
            size: f.size
        }));

        console.log(`[VideoExport] Uploaded ${files.length} files for job ${jobId}`);

        videoExportService.updateJob(jobId, { status: 'uploading', progress: 10 });

        res.json({
            success: true,
            uploadedFiles,
            message: `Uploaded ${files.length} files`
        });
    } catch (error) {
        console.error('[VideoExport] Error uploading files:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to upload files'
        });
    }
});

/**
 * POST /api/video-export/upload-text-frames/:jobId
 * Upload pre-rendered text frame sequences
 * Converts PNG frames to transparent WebM videos for FFmpeg overlay
 */
router.post('/upload-text-frames/:jobId', upload.array('frames', 500), async (req: Request, res: Response) => {
    try {
        const { jobId } = req.params;
        const files = req.files as Express.Multer.File[];
        const metadata = JSON.parse(req.body.metadata || '{}');

        const job = videoExportService.getJob(jobId);
        if (!job) {
            return res.status(404).json({ success: false, error: 'Job not found' });
        }

        const jobDir = videoExportService.getJobDir(jobId);
        const textDir = path.join(jobDir, 'text', metadata.textItemId);

        // Ensure directory exists
        if (!fs.existsSync(textDir)) {
            fs.mkdirSync(textDir, { recursive: true });
        }

        // Move frames to organized directory
        for (const file of files) {
            const destPath = path.join(textDir, file.originalname);
            fs.renameSync(file.path, destPath);
        }

        // Convert frames to video using FFmpeg
        const outputVideo = path.join(textDir, 'text_overlay.webm');

        await videoExportService.convertFramesToVideo(
            textDir,
            outputVideo,
            metadata.fps,
            metadata.width,
            metadata.height
        );

        // Store text overlay info for final compositing
        videoExportService.addTextOverlay(jobId, {
            textItemId: metadata.textItemId,
            videoPath: outputVideo,
            startTime: metadata.startTime,
            duration: metadata.duration,
            width: metadata.width,
            height: metadata.height
        });

        console.log(`[VideoExport] Converted ${files.length} text frames to video: ${outputVideo}`);

        res.json({
            success: true,
            message: `Converted ${files.length} frames to video`,
            videoPath: outputVideo
        });
    } catch (error) {
        console.error('[VideoExport] Error uploading text frames:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to upload text frames'
        });
    }
});

/**
 * POST /api/video-export/process/:jobId
 * Start processing the export
 */
router.post('/process/:jobId', async (req: Request, res: Response) => {
    try {
        const { jobId } = req.params;
        const { timeline, settings } = req.body as StartExportRequest;

        const job = videoExportService.getJob(jobId);
        if (!job) {
            return res.status(404).json({ success: false, error: 'Job not found' });
        }

        // Update local paths in timeline based on uploaded files
        const jobDir = videoExportService.getJobDir(jobId);
        const files = fs.readdirSync(jobDir);

        // Map uploaded files to timeline items
        for (const track of timeline.tracks) {
            for (const item of track.items) {
                // Sanitize item name the same way as when uploaded
                const sanitizedItemName = item.name
                    .replace(/[\\/:*?"<>|]/g, '_')
                    .replace(/\s+/g, '_')
                    .replace(/_+/g, '_')
                    .substring(0, 100);

                // Find matching uploaded file
                const matchingFile = files.find(f =>
                    f.includes(item.id) || f.includes(sanitizedItemName)
                );
                if (matchingFile) {
                    item.localPath = path.join(jobDir, matchingFile);
                }
            }
        }

        // Start processing in background
        videoExportService.processExport(jobId, timeline, settings);

        res.json({
            success: true,
            jobId,
            message: 'Export processing started. Poll /status for progress.'
        });
    } catch (error) {
        console.error('[VideoExport] Error processing:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to start processing'
        });
    }
});

/**
 * GET /api/video-export/status/:jobId
 * Get export job status
 */
router.get('/status/:jobId', async (req: Request, res: Response) => {
    try {
        const { jobId } = req.params;

        const job = videoExportService.getJob(jobId);
        if (!job) {
            return res.status(404).json({ success: false, error: 'Job not found' });
        }

        res.json({
            success: true,
            status: job.status,
            progress: job.progress,
            error: job.error,
            downloadReady: job.status === 'complete' && !!job.outputUrl
        });
    } catch (error) {
        console.error('[VideoExport] Error getting status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get status'
        });
    }
});

/**
 * GET /api/video-export/download/:jobId
 * Download the exported video
 */
router.get('/download/:jobId', async (req: Request, res: Response) => {
    try {
        const { jobId } = req.params;

        const job = videoExportService.getJob(jobId);
        if (!job) {
            return res.status(404).json({ success: false, error: 'Job not found' });
        }

        if (job.status !== 'complete' || !job.outputUrl) {
            return res.status(400).json({
                success: false,
                error: 'Export not complete'
            });
        }

        if (!fs.existsSync(job.outputUrl)) {
            return res.status(404).json({
                success: false,
                error: 'Output file not found'
            });
        }

        const filename = `export-${jobId}.${job.settings?.format || 'mp4'}`;
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', job.settings?.format === 'webm' ? 'video/webm' : 'video/mp4');

        const stream = fs.createReadStream(job.outputUrl);

        // Cleanup after download completes
        stream.on('end', () => {
            console.log(`[VideoExport] 🧹 Download complete, cleaning up job: ${jobId}`);
            videoExportService.cleanupJob(jobId).catch(e => {
                console.warn(`[VideoExport] Failed to cleanup after download:`, e);
            });
        });

        // Cleanup on stream error
        stream.on('error', (err) => {
            console.error(`[VideoExport] Stream error for job ${jobId}:`, err);
            videoExportService.cleanupJob(jobId).catch(e => {
                console.warn(`[VideoExport] Failed to cleanup after stream error:`, e);
            });
        });

        // Cleanup if client disconnects/closes connection
        res.on('close', () => {
            if (!res.writableEnded) {
                console.log(`[VideoExport] 🧹 Client disconnected, cleaning up job: ${jobId}`);
                stream.destroy(); // Stop reading the file
                videoExportService.cleanupJob(jobId).catch(e => {
                    console.warn(`[VideoExport] Failed to cleanup after client disconnect:`, e);
                });
            }
        });

        stream.pipe(res);
    } catch (error) {
        console.error('[VideoExport] Error downloading:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to download'
        });
    }
});

/**
 * POST /api/video-export/cancel/:jobId
 * Cancel an in-progress export job and cleanup
 */
router.post('/cancel/:jobId', async (req: Request, res: Response) => {
    try {
        const { jobId } = req.params;

        const cancelled = videoExportService.cancelJob(jobId);
        if (!cancelled) {
            return res.status(404).json({ success: false, error: 'Job not found' });
        }

        console.log(`[VideoExport] 🛑 Job ${jobId} cancelled by client`);

        res.json({
            success: true,
            message: 'Job cancelled and cleaned up'
        });
    } catch (error) {
        console.error('[VideoExport] Error cancelling job:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to cancel job'
        });
    }
});

/**
 * DELETE /api/video-export/:jobId
 * Cleanup a job and its files
 */
router.delete('/:jobId', async (req: Request, res: Response) => {
    try {
        const { jobId } = req.params;

        // Cancel to stop any processing, then cleanup
        videoExportService.cancelJob(jobId);
        await videoExportService.cleanupJob(jobId);

        res.json({
            success: true,
            message: 'Job cleaned up'
        });
    } catch (error) {
        console.error('[VideoExport] Error cleaning up:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to cleanup job'
        });
    }
});

export default router;
