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

        // Startup cleanup: Remove any stale export folders from previous crashes
        this.cleanupStaleExports();
    }

    // Track cancelled job IDs to stop processing
    private cancelledJobs = new Set<string>();

    /**
     * Cleanup stale export folders from previous crashes/incomplete exports
     * Called on startup to ensure clean state
     * Cleans ALL folders since server restart means any previous exports are orphaned
     */
    private cleanupStaleExports(): void {
        try {
            if (!fs.existsSync(TEMP_DIR)) return;

            const entries = fs.readdirSync(TEMP_DIR, { withFileTypes: true });
            let cleanedCount = 0;

            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const dirPath = path.join(TEMP_DIR, entry.name);
                    try {
                        // Clean ALL folders on startup - they're from previous sessions
                        fs.rmSync(dirPath, { recursive: true, force: true });
                        cleanedCount++;
                        console.log(`[VideoExport] 🧹 Cleaned export folder: ${entry.name}`);
                    } catch (e) {
                        console.warn(`[VideoExport] Failed to cleanup folder ${entry.name}:`, e);
                    }
                }
            }

            if (cleanedCount > 0) {
                console.log(`[VideoExport] 🧹 Startup cleanup: removed ${cleanedCount} export folders`);
            }
        } catch (e) {
            console.warn('[VideoExport] Startup cleanup failed:', e);
        }
    }

    /**
     * Cancel an export job
     * Marks the job as cancelled so processing will stop
     */
    cancelJob(jobId: string): boolean {
        const job = jobs.get(jobId);
        if (!job) return false;

        this.cancelledJobs.add(jobId);
        this.updateJob(jobId, { status: 'cancelled' as any });
        console.log(`[VideoExport] ❌ Job ${jobId} marked for cancellation`);

        // Cleanup immediately
        this.cleanupJob(jobId).catch(e => {
            console.warn(`[VideoExport] Failed to cleanup cancelled job:`, e);
        });

        return true;
    }

    /**
     * Check if a job is cancelled
     */
    isJobCancelled(jobId: string): boolean {
        return this.cancelledJobs.has(jobId);
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
     * Process export using frame-by-frame rendering
     * This provides full support for transitions, animations, and effects
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
        const framesDir = path.join(jobDir, 'frames');
        const outputPath = path.join(jobDir, `output.${settings.format}`);

        try {
            this.updateJob(jobId, {
                status: 'processing',
                timeline,
                settings,
                progress: 0
            });

            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(`🎬 STARTING SERVER-SIDE EXPORT (FRAME RENDERING): Job ${jobId}`);
            console.log(`📐 Resolution: ${settings.resolution.width}x${settings.resolution.height}`);
            console.log(`⏱️  Duration: ${timeline.duration}s`);
            console.log(`🎞️  FPS: ${settings.fps}`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

            // Check if we have media items - if so, use frame-by-frame rendering
            const mediaItems = this.getMediaItems(timeline);
            const hasMediaItems = mediaItems.length > 0;
            const hasTransitions = this.hasTransitions(timeline);
            const hasAnimations = this.hasAnimations(timeline);

            // Debug logging
            console.log(`📊 Media items: ${mediaItems.length}`);
            console.log(`🔀 Has transitions: ${hasTransitions}`);
            console.log(`💫 Has animations: ${hasAnimations}`);

            // Log transition/animation details
            for (const track of timeline.tracks) {
                for (const item of track.items) {
                    console.log(`   📁 Item "${item.name}" - localPath: ${item.localPath || 'NOT SET'}, src: ${item.src?.substring(0, 60)}...`);
                    if (item.transition) {
                        console.log(`   📎 Item "${item.name}" has transition: ${JSON.stringify(item.transition)}`);
                    }
                    if (item.animation) {
                        console.log(`   🎭 Item "${item.name}" has animation: ${JSON.stringify(item.animation)}`);
                    }
                }
            }

            // ALWAYS use frame-by-frame rendering for full feature support
            // FrameRenderer supports: filters, adjustments, flip, background color, transitions, animations
            // FFmpeg filter complex only supports basic compositing
            if (hasMediaItems) {
                console.log('📸 Using STREAMING FRAME RENDERING (memory-optimized)');

                try {
                    // Import FrameRenderer dynamically to avoid circular dependencies
                    const { FrameRenderer } = await import('./export/FrameRenderer');

                    // Create frame renderer
                    const frameRenderer = new FrameRenderer(
                        settings.resolution.width,
                        settings.resolution.height
                    );

                    // Collect audio items BEFORE starting render (async - probes video files for audio)
                    const audioInputs = await this.collectAudioInputs(timeline, jobDir);

                    // Use streaming method - renders and encodes in one pass
                    // No temp frame files are created (memory-optimized)
                    this.updateJob(jobId, { status: 'processing', progress: 0 });

                    await frameRenderer.renderAllFramesStreaming(
                        timeline,
                        settings,
                        outputPath,
                        audioInputs,
                        (progress) => {
                            // Streaming method reports 0-90% progress
                            this.updateJob(jobId, { progress });
                            onProgress?.(progress);
                        }
                    );

                    // Cleanup caches
                    FrameRenderer.clearCache();

                    // No frames directory to cleanup - streaming mode doesn't create temp files!
                    console.log('🧹 No temp frame files to cleanup (streaming mode)');

                } catch (frameRenderError) {
                    console.error('[VideoExport] Streaming render failed, falling back to disk-based:', frameRenderError);

                    // Fall back to disk-based frame rendering (original method)
                    try {
                        console.log('🎞️  Fallback: Using disk-based frame rendering');
                        const { FrameRenderer, encodeFramesToVideo } = await import('./export/FrameRenderer');

                        const frameRenderer = new FrameRenderer(
                            settings.resolution.width,
                            settings.resolution.height
                        );

                        await frameRenderer.renderAllFrames(
                            timeline,
                            settings,
                            framesDir,
                            (renderProgress) => {
                                const progress = renderProgress * 0.8;
                                this.updateJob(jobId, { progress });
                                onProgress?.(progress);
                            }
                        );

                        const audioInputs = await this.collectAudioInputs(timeline, jobDir);
                        this.updateJob(jobId, { status: 'encoding', progress: 80 });

                        await encodeFramesToVideo(
                            framesDir,
                            outputPath,
                            settings,
                            audioInputs,
                            (encodeProgress) => {
                                const progress = 80 + encodeProgress * 0.2;
                                this.updateJob(jobId, { progress });
                                onProgress?.(progress);
                            }
                        );

                        FrameRenderer.clearCache();
                        try {
                            fs.rmSync(framesDir, { recursive: true, force: true });
                        } catch (e) {
                            console.warn('[VideoExport] Failed to cleanup frames dir:', e);
                        }
                    } catch (fallbackError) {
                        console.error('[VideoExport] Fallback also failed:', fallbackError);
                        // Last resort: FFmpeg filter complex
                        console.log('🎞️  Last resort: Using FFmpeg filter complex');
                        const ffmpegArgs = this.buildFFmpegCommand(timeline, settings, jobDir, outputPath);
                        await this.runFFmpeg(ffmpegArgs, (progress) => {
                            this.updateJob(jobId, { progress });
                            onProgress?.(progress);
                        });
                    }
                }
            } else {
                // No media items - just render background or text
                console.log('🎞️  Using FFmpeg for text-only export');
                const ffmpegArgs = this.buildFFmpegCommand(timeline, settings, jobDir, outputPath);
                console.log(`[VideoExport] FFmpeg args:`, ffmpegArgs.join(' '));

                await this.runFFmpeg(ffmpegArgs, (progress) => {
                    this.updateJob(jobId, { progress });
                    onProgress?.(progress);
                });
            }

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

            // Cleanup job directory on error to prevent temp files from accumulating
            try {
                const jobDir = this.getJobDir(jobId);
                if (fs.existsSync(jobDir)) {
                    fs.rmSync(jobDir, { recursive: true, force: true });
                    console.log(`[VideoExport] 🧹 Cleaned up job directory after error: ${jobId}`);
                }
            } catch (cleanupError) {
                console.warn(`[VideoExport] Failed to cleanup job directory after error:`, cleanupError);
            }

            throw error;
        }
    }

    /**
     * Check if timeline has transitions
     */
    private hasTransitions(timeline: TimelineData): boolean {
        for (const track of timeline.tracks) {
            for (const item of track.items) {
                if (item.transition && item.transition.type !== 'none') {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Check if timeline has animations
     */
    private hasAnimations(timeline: TimelineData): boolean {
        for (const track of timeline.tracks) {
            for (const item of track.items) {
                if (item.animation && item.animation.type) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Collect audio inputs from timeline for mixing
     */
    private async collectAudioInputs(timeline: TimelineData, jobDir: string): Promise<Array<{
        file: string;
        startTime: number;
        offset: number;
        duration: number;
    }>> {
        // Import probeHasAudioStream for detecting audio streams in video files
        const { probeHasAudioStream } = await import('../utils/media/probe');

        const inputs: Array<{ file: string; startTime: number; offset: number; duration: number }> = [];

        for (const track of timeline.tracks) {
            if (track.type === 'audio') {
                for (const item of track.items) {
                    if (item.localPath && fs.existsSync(item.localPath)) {
                        inputs.push({
                            file: item.localPath,
                            startTime: item.start,
                            offset: item.offset || 0,
                            duration: item.duration
                        });
                        console.log(`[VideoExport] Added audio track: ${item.name}`);
                    }
                }
            }
            // Include video audio (only if has audio stream AND not muted)
            if (track.type === 'video') {
                for (const item of track.items) {
                    if (item.type === 'video' && !item.muteVideo && item.localPath && fs.existsSync(item.localPath)) {
                        // Probe the video file to detect if it has an audio stream
                        const hasAudioStream = await probeHasAudioStream(item.localPath);
                        if (hasAudioStream) {
                            inputs.push({
                                file: item.localPath,
                                startTime: item.start,
                                offset: item.offset || 0,
                                duration: item.duration
                            });
                            console.log(`[VideoExport] Video with audio stream (probed): ${item.name}`);
                        } else {
                            console.log(`[VideoExport] Video has no audio stream (probed): ${item.name}`);
                        }
                    } else if (item.type === 'video' && item.muteVideo) {
                        console.log(`[VideoExport] Video muted (skipping audio): ${item.name}`);
                    }
                }
            }
        }

        console.log(`[VideoExport] Total audio sources: ${inputs.length}`);
        return inputs;
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
        let videoFilterComplex = '';
        if (mediaItems.length > 0 || textItems.length > 0) {
            videoFilterComplex = this.buildFilterComplex(mediaItems, settings, duration, textItems);
        }

        // Audio mixing filter (only for dedicated audio items, not video audio)
        // For video audio, we need to track the input index properly
        let audioFilterComplex = '';
        let hasAudioOutput = false;

        // Only add audio filter for dedicated audio track items
        const dedicatedAudioItems = audioItems.filter(item => item.type === 'audio');
        if (dedicatedAudioItems.length > 0) {
            audioFilterComplex = this.buildAudioFilter(dedicatedAudioItems, mediaItems.length);
            hasAudioOutput = true;
        }

        // Combine filters into a single -filter_complex
        if (videoFilterComplex || audioFilterComplex) {
            const combinedFilter = [videoFilterComplex, audioFilterComplex].filter(Boolean).join(';');
            if (combinedFilter) {
                args.push('-filter_complex', combinedFilter);
                if (videoFilterComplex) {
                    args.push('-map', '[out]');
                }
                if (hasAudioOutput) {
                    args.push('-map', '[aout]');
                }
            }
        }

        // If video has audio but no dedicated audio track, map audio directly from video input
        const videoWithAudio = audioItems.filter(item => item.type === 'video' && item.hasAudio === true);
        if (videoWithAudio.length > 0 && !hasAudioOutput) {
            // Find the index of the first video with audio
            const videoIndex = mediaItems.findIndex(item =>
                item.id === videoWithAudio[0].id && item.hasAudio === true
            );
            if (videoIndex >= 0) {
                args.push('-map', `${videoIndex}:a?`); // Use ? to make audio optional
                hasAudioOutput = true;
            }
        }

        // Output settings
        // Encoder selection based on format
        const format = settings.format;

        // Quality CRF values
        const crfHigh = 18;
        const crfMedium = 23;
        const crfLow = 28;
        const crf = settings.quality === 'high' ? crfHigh : settings.quality === 'medium' ? crfMedium : crfLow;

        // Format-specific video encoding
        switch (format) {
            case 'webm':
                // WebM - VP9 codec
                if (settings.useHardwareAccel) {
                    args.push('-c:v', 'vp9');
                    args.push('-deadline', 'realtime');
                    args.push('-cpu-used', '4');
                } else {
                    args.push('-c:v', 'libvpx-vp9');
                    args.push('-deadline', 'good');
                    args.push('-cpu-used', '2');
                }
                args.push('-crf', String(crf + 10)); // VP9 uses higher CRF
                args.push('-b:v', '0');
                break;

            case 'mov':
                // MOV - H.264 with QuickTime compatibility
                if (settings.useHardwareAccel) {
                    args.push('-c:v', 'h264_nvenc');
                    args.push('-preset', 'fast');
                } else {
                    args.push('-c:v', 'libx264');
                    args.push('-preset', 'medium');
                }
                args.push('-crf', String(crf));
                args.push('-tag:v', 'avc1'); // QuickTime compatibility
                break;

            case 'mkv':
                // MKV - H.264 high quality
                if (settings.useHardwareAccel) {
                    args.push('-c:v', 'h264_nvenc');
                    args.push('-preset', 'fast');
                } else {
                    args.push('-c:v', 'libx264');
                    args.push('-preset', 'medium');
                }
                args.push('-crf', String(crf));
                break;

            case 'avi':
                // AVI - MPEG-4 for legacy compatibility
                const aviQuality = settings.quality === 'high' ? 2 : settings.quality === 'medium' ? 4 : 6;
                args.push('-c:v', 'mpeg4');
                args.push('-q:v', String(aviQuality));
                break;

            default: // mp4
                // MP4 - H.264 best compatibility
                if (settings.useHardwareAccel) {
                    args.push('-c:v', 'h264_nvenc');
                    args.push('-preset', 'fast');
                } else {
                    args.push('-c:v', 'libx264');
                    args.push('-preset', 'medium');
                }
                args.push('-crf', String(crf));
                break;
        }

        // Output format settings
        args.push('-pix_fmt', 'yuv420p');
        args.push('-r', String(settings.fps));
        args.push('-t', String(duration));

        // Container-specific flags
        if (format === 'mp4' || format === 'mov') {
            args.push('-movflags', '+faststart');
        }

        // Audio codec - format-specific
        if (hasAudioOutput) {
            switch (format) {
                case 'webm':
                    args.push('-c:a', 'libopus');
                    args.push('-b:a', '192k');
                    break;
                case 'avi':
                    args.push('-c:a', 'libmp3lame');
                    args.push('-b:a', '192k');
                    break;
                default: // mp4, mov, mkv
                    args.push('-c:a', 'aac');
                    args.push('-b:a', '192k');
                    break;
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
     * Includes: explicit audio tracks + video items with audio (hasAudio=true and not muteVideo)
     */
    private getAudioItems(timeline: TimelineData): TimelineItemData[] {
        const items: TimelineItemData[] = [];
        for (const track of timeline.tracks) {
            if (track.type === 'audio') {
                items.push(...track.items);
                console.log(`[VideoExport] Found ${track.items.length} audio track items`);
            }
            // Include video items ONLY if they have audio AND not muted
            // hasAudio = true means the video file has an audio stream
            // muteVideo = true means user clicked "Remove Audio" in editor
            if (track.type === 'video') {
                for (const item of track.items) {
                    if (item.type === 'video') {
                        if (item.muteVideo === true) {
                            console.log(`[VideoExport] Video muted (skipping audio): ${item.name}`);
                        } else if (item.hasAudio !== true) {
                            console.log(`[VideoExport] Video has no audio stream: ${item.name}`);
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
