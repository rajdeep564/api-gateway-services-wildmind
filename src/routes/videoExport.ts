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
        // Sanitize filename - remove Windows-invalid characters: \ / : * ? " < > |
        const sanitizedName = file.originalname
            .replace(/[\\/:*?"<>|]/g, '_')  // Replace invalid chars with underscore
            .replace(/\s+/g, '_')            // Replace spaces with underscore
            .replace(/_+/g, '_')             // Collapse multiple underscores
            .substring(0, 100);              // Limit length to prevent path too long errors

        const uniqueName = `${Date.now()}-${sanitizedName}`;
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
 * DELETE /api/video-export/:jobId
 * Cleanup a job and its files
 */
router.delete('/:jobId', async (req: Request, res: Response) => {
    try {
        const { jobId } = req.params;

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
