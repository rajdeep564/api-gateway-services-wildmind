// ============================================
// Video Export Service
// Server-side video export using FFmpeg
// Supports hardware acceleration (NVENC/VCE/QuickSync)
// ============================================

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import ffmpegPath from 'ffmpeg-static';
import type {
    ExportJob,
    TimelineData,
    ExportSettings,
    TimelineItemData
} from '../types/videoExport';

// In-memory job storage (use Redis in production)
const jobs = new Map<string, ExportJob>();

// Temp directory for exports
const TEMP_DIR = path.join(process.cwd(), 'temp', 'exports');

class VideoExportService {
    constructor() {
        // Ensure temp directory exists
        if (!fs.existsSync(TEMP_DIR)) {
            fs.mkdirSync(TEMP_DIR, { recursive: true });
        }
    }

    /**
     * Create a new export job
     */
    async createJob(userId: string): Promise<ExportJob> {
        const jobId = uuidv4();
        const job: ExportJob = {
            id: jobId,
            userId,
            status: 'pending',
            progress: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        jobs.set(jobId, job);
        console.log(`[VideoExport] Created job ${jobId} for user ${userId}`);
        return job;
    }

    /**
     * Get job status
     */
    getJob(jobId: string): ExportJob | undefined {
        return jobs.get(jobId);
    }

    /**
     * Get job directory
     */
    getJobDir(jobId: string): string {
        const dir = path.join(TEMP_DIR, jobId);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
    }

    /**
     * Update job status
     */
    updateJob(jobId: string, updates: Partial<ExportJob>): void {
        const job = jobs.get(jobId);
        if (job) {
            Object.assign(job, updates, { updatedAt: new Date() });
            jobs.set(jobId, job);
        }
    }

    /**
     * Process export using FFmpeg
     */
    async processExport(
        jobId: string,
        timeline: TimelineData,
        settings: ExportSettings,
        onProgress?: (progress: number) => void
    ): Promise<string> {
        const job = this.getJob(jobId);
        if (!job) throw new Error('Job not found');

        const jobDir = this.getJobDir(jobId);
        const outputPath = path.join(jobDir, `output.${settings.format}`);

        try {
            this.updateJob(jobId, {
                status: 'processing',
                timeline,
                settings,
                progress: 0
            });

            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(`🎬 STARTING SERVER-SIDE EXPORT: Job ${jobId}`);
            console.log(`📐 Resolution: ${settings.resolution.width}x${settings.resolution.height}`);
            console.log(`⏱️  Duration: ${timeline.duration}s`);
            console.log(`🎞️  FPS: ${settings.fps}`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

            // Build FFmpeg command
            const ffmpegArgs = this.buildFFmpegCommand(timeline, settings, jobDir, outputPath);

            console.log(`[VideoExport] FFmpeg args:`, ffmpegArgs.join(' '));

            // Execute FFmpeg
            await this.runFFmpeg(ffmpegArgs, (progress) => {
                this.updateJob(jobId, { progress });
                onProgress?.(progress);
            });

            this.updateJob(jobId, {
                status: 'complete',
                progress: 100,
                outputUrl: outputPath
            });

            console.log(`✅ Export complete: ${outputPath}`);
            return outputPath;

        } catch (error) {
            console.error(`[VideoExport] Error processing job ${jobId}:`, error);
            this.updateJob(jobId, {
                status: 'error',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }

    /**
     * Build FFmpeg command based on timeline
     */
    private buildFFmpegCommand(
        timeline: TimelineData,
        settings: ExportSettings,
        jobDir: string,
        outputPath: string
    ): string[] {
        const args: string[] = [];
        const { width, height } = settings.resolution;
        const duration = timeline.duration;

        // Get video/image inputs from timeline
        const mediaItems = this.getMediaItems(timeline);
        const audioItems = this.getAudioItems(timeline);

        // Input files
        for (const item of mediaItems) {
            if (item.localPath && fs.existsSync(item.localPath)) {
                args.push('-i', item.localPath);
            }
        }

        // Audio inputs
        for (const item of audioItems) {
            if (item.localPath && fs.existsSync(item.localPath)) {
                args.push('-i', item.localPath);
            }
        }

        // If no inputs, create black video
        if (mediaItems.length === 0) {
            args.push(
                '-f', 'lavfi',
                '-i', `color=c=black:s=${width}x${height}:d=${duration}:r=${settings.fps}`
            );
        }

        // Get text items for overlay
        const textItems = this.getTextItems(timeline);
        console.log(`[VideoExport] Found ${textItems.length} text items to render`);

        // Video filter complex for compositing
        if (mediaItems.length > 0 || textItems.length > 0) {
            const filterComplex = this.buildFilterComplex(mediaItems, settings, duration, textItems);
            if (filterComplex) {
                args.push('-filter_complex', filterComplex);
                args.push('-map', '[out]');
            }
        }

        // Audio mixing
        if (audioItems.length > 0) {
            const audioFilter = this.buildAudioFilter(audioItems, mediaItems.length);
            if (audioFilter) {
                args.push('-filter_complex', audioFilter);
                args.push('-map', '[aout]');
            }
        }

        // Output settings
        // Encoder selection based on format
        const isWebM = settings.format === 'webm';

        if (isWebM) {
            // WebM requires VP8, VP9, or AV1
            if (settings.useHardwareAccel) {
                // Try VP9 hardware encoding (not widely supported)
                args.push('-c:v', 'vp9');
                args.push('-deadline', 'realtime');
                args.push('-cpu-used', '4');
            } else {
                args.push('-c:v', 'libvpx-vp9');
                args.push('-deadline', 'good');
                args.push('-cpu-used', '2');
            }
            // Quality for VP9 (use -crf or -b:v, not both)
            const crf = settings.quality === 'high' ? 30 : settings.quality === 'medium' ? 35 : 40;
            args.push('-crf', String(crf));
            args.push('-b:v', '0'); // Use -crf mode (constant quality)
        } else {
            // MP4 uses H.264
            if (settings.useHardwareAccel) {
                // Try NVIDIA NVENC first
                args.push('-c:v', 'h264_nvenc');
                args.push('-preset', 'fast');
            } else {
                args.push('-c:v', 'libx264');
                args.push('-preset', 'medium');
            }
            // Quality settings for H.264
            const crf = settings.quality === 'high' ? 18 : settings.quality === 'medium' ? 23 : 28;
            args.push('-crf', String(crf));
        }

        // Output format settings
        args.push('-pix_fmt', 'yuv420p');
        args.push('-r', String(settings.fps));
        args.push('-t', String(duration));

        // Only add movflags for MP4
        if (!isWebM) {
            args.push('-movflags', '+faststart');
        }

        // Audio codec
        if (audioItems.length > 0) {
            if (isWebM) {
                // WebM requires Vorbis or Opus
                args.push('-c:a', 'libopus');
                args.push('-b:a', '192k');
            } else {
                // MP4 uses AAC
                args.push('-c:a', 'aac');
                args.push('-b:a', '192k');
            }
        }

        // Output file
        args.push('-y', outputPath);

        return args;
    }

    /**
     * Build video filter complex for compositing multiple layers including text
     */
    private buildFilterComplex(
        items: TimelineItemData[],
        settings: ExportSettings,
        duration: number,
        textItems: TimelineItemData[] = []
    ): string {
        const { width, height } = settings.resolution;
        const filters: string[] = [];

        // Create base canvas
        filters.push(`color=c=black:s=${width}x${height}:d=${duration}[base]`);

        // Overlay each media item
        let currentOutput = 'base';
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const inputIdx = i;
            const isLastMedia = i === items.length - 1 && textItems.length === 0;
            const nextOutput = isLastMedia ? 'out' : `v${i}`;

            // Scale and position
            let itemFilter = `[${inputIdx}:v]`;

            // Apply fit mode
            if (item.isBackground) {
                if (item.fit === 'contain') {
                    itemFilter += `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
                } else if (item.fit === 'cover') {
                    itemFilter += `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
                } else {
                    itemFilter += `scale=${width}:${height}`;
                }
            } else {
                const w = item.width ? Math.round((item.width / 100) * width) : width / 2;
                const h = item.height ? Math.round((item.height / 100) * height) : height / 2;
                itemFilter += `scale=${w}:${h}`;
            }

            // Apply filters (brightness, contrast, etc.)
            if (item.brightness) {
                itemFilter += `,eq=brightness=${(item.brightness - 100) / 100}`;
            }
            if (item.contrast) {
                itemFilter += `:contrast=${item.contrast / 100}`;
            }
            if (item.saturation) {
                itemFilter += `:saturation=${item.saturation / 100}`;
            }

            // Apply rotation
            if (item.rotation) {
                itemFilter += `,rotate=${item.rotation}*PI/180:c=none`;
            }

            // Apply opacity
            if (item.opacity && item.opacity < 100) {
                itemFilter += `,format=rgba,colorchannelmixer=aa=${item.opacity / 100}`;
            }

            itemFilter += `[scaled${i}]`;
            filters.push(itemFilter);

            // Calculate position
            const x = item.isBackground ? 0 : Math.round((width / 2) + ((item.x || 0) / 100) * width - (item.width ? (item.width / 100) * width / 2 : width / 4));
            const y = item.isBackground ? 0 : Math.round((height / 2) + ((item.y || 0) / 100) * height - (item.height ? (item.height / 100) * height / 2 : height / 4));

            // Overlay with timing
            const enableExpr = `between(t,${item.start},${item.start + item.duration})`;
            filters.push(
                `[${currentOutput}][scaled${i}]overlay=x=${x}:y=${y}:enable='${enableExpr}'[${nextOutput}]`
            );

            currentOutput = nextOutput;
        }

        // Add text overlays using drawtext filter
        for (let i = 0; i < textItems.length; i++) {
            const textItem = textItems[i];
            const isLast = i === textItems.length - 1;
            const nextOutput = isLast ? 'out' : `t${i}`;

            // Build drawtext filter
            const textFilter = this.buildDrawtextFilter(textItem, width, height);
            filters.push(`[${currentOutput}]${textFilter}[${nextOutput}]`);

            currentOutput = nextOutput;
        }

        return filters.join(';');
    }

    /**
     * Build FFmpeg drawtext filter for a text item
     */
    private buildDrawtextFilter(
        item: TimelineItemData,
        canvasWidth: number,
        canvasHeight: number
    ): string {
        // Escape text for FFmpeg (escape colons, backslashes, single quotes)
        let text = (item.name || '').replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\\'");

        // Apply text transform
        if (item.textTransform === 'uppercase') {
            text = text.toUpperCase();
        } else if (item.textTransform === 'lowercase') {
            text = text.toLowerCase();
        }

        // Font settings
        const fontSize = item.fontSize || 40;
        const fontFamily = (item.fontFamily || 'Arial').replace(/ /g, '\\ '); // Escape spaces
        const fontColor = (item.color || '#ffffff').replace('#', '0x');

        // Calculate position (x, y are percentages relative to center)
        const x = Math.round((canvasWidth / 2) + ((item.x || 0) / 100) * canvasWidth);
        const y = Math.round((canvasHeight / 2) + ((item.y || 0) / 100) * canvasHeight);

        // Build filter parts
        const filterParts: string[] = [
            `drawtext=text='${text}'`,
            `fontsize=${fontSize}`,
            `fontcolor=${fontColor}`,
            `x=${x}-(tw/2)`, // Center horizontally
            `y=${y}-(th/2)`, // Center vertically
            `enable='between(t,${item.start},${item.start + item.duration})'`
        ];

        // Add font if available (use default if not found)
        // Note: FFmpeg needs a valid font file path on the server
        // For cross-platform compatibility, we'll use fontfamily
        filterParts.push(`font='${fontFamily}'`);

        // Apply text effects (shadow)
        if (item.textEffect?.type === 'shadow') {
            const shadowColor = (item.textEffect.color || '#000000').replace('#', '0x');
            filterParts.push(`shadowcolor=${shadowColor}`);
            filterParts.push(`shadowx=2`);
            filterParts.push(`shadowy=2`);
        }

        // Apply border/outline effect
        if (item.textEffect?.type === 'outline') {
            const borderColor = (item.textEffect.color || '#000000').replace('#', '0x');
            filterParts.push(`bordercolor=${borderColor}`);
            filterParts.push(`borderw=2`);
        }

        return filterParts.join(':');
    }

    /**
     * Build audio filter for mixing multiple audio tracks
     */
    private buildAudioFilter(audioItems: TimelineItemData[], videoInputCount: number): string {
        const filters: string[] = [];
        const mixInputs: string[] = [];

        for (let i = 0; i < audioItems.length; i++) {
            const item = audioItems[i];
            const inputIdx = videoInputCount + i;
            const delayMs = Math.round(item.start * 1000);

            filters.push(`[${inputIdx}:a]adelay=${delayMs}|${delayMs},atrim=start=${item.offset}:duration=${item.duration}[a${i}]`);
            mixInputs.push(`[a${i}]`);
        }

        if (mixInputs.length > 0) {
            filters.push(`${mixInputs.join('')}amix=inputs=${audioItems.length}:duration=longest[aout]`);
        }

        return filters.join(';');
    }

    /**
     * Get media items (video/image) from timeline
     */
    private getMediaItems(timeline: TimelineData): TimelineItemData[] {
        const items: TimelineItemData[] = [];
        for (const track of timeline.tracks) {
            if (track.type === 'video' || track.type === 'overlay') {
                for (const item of track.items) {
                    if (item.type === 'video' || item.type === 'image') {
                        items.push(item);
                    }
                }
            }
        }
        // Sort by layer/start time
        return items.sort((a, b) => a.start - b.start);
    }

    /**
     * Get text items from timeline
     */
    private getTextItems(timeline: TimelineData): TimelineItemData[] {
        const items: TimelineItemData[] = [];
        for (const track of timeline.tracks) {
            for (const item of track.items) {
                if (item.type === 'text') {
                    items.push(item);
                    console.log(`[VideoExport] Found text item: "${item.name}" at ${item.start}s`);
                }
            }
        }
        // Sort by start time (text renders on top of media)
        return items.sort((a, b) => a.start - b.start);
    }

    /**
     * Get audio items from timeline
     * Includes: explicit audio tracks + video items (unless muteVideo is set)
     */
    private getAudioItems(timeline: TimelineData): TimelineItemData[] {
        const items: TimelineItemData[] = [];
        for (const track of timeline.tracks) {
            if (track.type === 'audio') {
                items.push(...track.items);
                console.log(`[VideoExport] Found ${track.items.length} audio track items`);
            }
            // Include video items UNLESS they have muteVideo set
            // muteVideo = true means user clicked "Remove Audio" in editor
            if (track.type === 'video') {
                for (const item of track.items) {
                    if (item.type === 'video') {
                        if (item.muteVideo === true) {
                            console.log(`[VideoExport] Video muted (skipping audio): ${item.name}`);
                        } else {
                            items.push(item);
                            console.log(`[VideoExport] Video with audio: ${item.name}`);
                        }
                    }
                }
            }
        }
        console.log(`[VideoExport] Total audio sources: ${items.length}`);
        return items;
    }

    /**
     * Run FFmpeg with progress tracking
     */
    private runFFmpeg(args: string[], onProgress?: (progress: number) => void): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!ffmpegPath) {
                return reject(new Error('FFmpeg binary not found. Please install ffmpeg-static.'));
            }
            console.log(`[VideoExport] Starting FFmpeg from: ${ffmpegPath}`);
            const ffmpeg = spawn(ffmpegPath, args);
            let duration = 0;

            ffmpeg.stderr.on('data', (data) => {
                const str = data.toString();
                console.log('[FFmpeg]', str);

                // Parse duration
                const durationMatch = str.match(/Duration: (\d+):(\d+):(\d+)/);
                if (durationMatch) {
                    const [, h, m, s] = durationMatch;
                    duration = parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s);
                }

                // Parse progress
                const timeMatch = str.match(/time=(\d+):(\d+):(\d+)/);
                if (timeMatch && duration > 0) {
                    const [, h, m, s] = timeMatch;
                    const currentTime = parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s);
                    const progress = Math.min(100, (currentTime / duration) * 100);
                    onProgress?.(progress);
                }
            });

            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`FFmpeg exited with code ${code}`));
                }
            });

            ffmpeg.on('error', reject);
        });
    }

    // Storage for text overlays per job
    private textOverlays = new Map<string, Array<{
        textItemId: string;
        videoPath: string;
        startTime: number;
        duration: number;
        width: number;
        height: number;
    }>>();

    /**
     * Add a text overlay to the job
     */
    addTextOverlay(jobId: string, overlay: {
        textItemId: string;
        videoPath: string;
        startTime: number;
        duration: number;
        width: number;
        height: number;
    }): void {
        if (!this.textOverlays.has(jobId)) {
            this.textOverlays.set(jobId, []);
        }
        this.textOverlays.get(jobId)!.push(overlay);
        console.log(`[VideoExport] Added text overlay ${overlay.textItemId} to job ${jobId}`);
    }

    /**
     * Get text overlays for a job
     */
    getTextOverlays(jobId: string): Array<{
        textItemId: string;
        videoPath: string;
        startTime: number;
        duration: number;
        width: number;
        height: number;
    }> {
        return this.textOverlays.get(jobId) || [];
    }

    /**
     * Convert PNG frames to transparent WebM video
     */
    async convertFramesToVideo(
        framesDir: string,
        outputPath: string,
        fps: number,
        width: number,
        height: number
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!ffmpegPath) {
                return reject(new Error('FFmpeg binary not found'));
            }

            const args = [
                '-y',
                '-framerate', String(fps),
                '-i', path.join(framesDir, 'frame_%05d.png'),
                '-c:v', 'libvpx-vp9',
                '-pix_fmt', 'yuva420p', // Transparent format
                '-deadline', 'realtime',
                '-cpu-used', '4',
                '-b:v', '0',
                '-crf', '30',
                '-s', `${width}x${height}`,
                outputPath
            ];

            console.log(`[VideoExport] Converting frames to video: ffmpeg ${args.join(' ')}`);

            const ffmpeg = spawn(ffmpegPath, args);

            ffmpeg.stderr.on('data', (data) => {
                // Just log, don't parse for this helper
                console.log('[FFmpeg Frame2Video]', data.toString().substring(0, 200));
            });

            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    console.log(`[VideoExport] Frame conversion complete: ${outputPath}`);
                    resolve();
                } else {
                    reject(new Error(`FFmpeg frame conversion exited with code ${code}`));
                }
            });

            ffmpeg.on('error', reject);
        });
    }

    /**
     * Cleanup job files
     */
    async cleanupJob(jobId: string): Promise<void> {
        const jobDir = path.join(TEMP_DIR, jobId);
        if (fs.existsSync(jobDir)) {
            fs.rmSync(jobDir, { recursive: true });
        }
        jobs.delete(jobId);
        this.textOverlays.delete(jobId);
        console.log(`[VideoExport] Cleaned up job ${jobId}`);
    }
}

export const videoExportService = new VideoExportService();
