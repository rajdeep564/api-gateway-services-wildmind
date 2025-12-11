// ============================================
// Frame Renderer for Server-Side Video Export
// Renders individual frames using node-canvas
// Ports rendering logic from FFmpegExportService.ts
// ============================================

import { createCanvas, loadImage, Canvas, CanvasRenderingContext2D, Image } from 'canvas';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import type { TimelineData, TimelineItemData, TrackData, ExportSettings } from '../../types/videoExport';
import { calculateTransitionStyle, TransitionStyle } from './TransitionEngine';
import { calculateAnimationStyle, AnimationStyle } from './AnimationEngine';

// Internal type for rendering items with transition info
interface RenderItem {
    item: TimelineItemData;
    track: TrackData;
    role: 'main' | 'outgoing';
    transition: TimelineItemData['transition'] | null;
    transitionProgress: number;
}

// Media cache to avoid reloading images
const imageCache = new Map<string, Image>();

export class FrameRenderer {
    private canvas: Canvas;
    private ctx: CanvasRenderingContext2D;
    private width: number;
    private height: number;

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.canvas = createCanvas(width, height);
        this.ctx = this.canvas.getContext('2d');
    }

    /**
     * Render all frames for a timeline and save to output directory
     */
    async renderAllFrames(
        timeline: TimelineData,
        settings: ExportSettings,
        outputDir: string,
        onProgress?: (progress: number) => void
    ): Promise<number> {
        const fps = settings.fps;
        const totalFrames = Math.ceil(timeline.duration * fps);

        // Ensure output directory exists
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        console.log(`[FrameRenderer] Rendering ${totalFrames} frames at ${fps}fps...`);

        // Set temp directory for video frame extraction
        const tempFrameDir = path.join(outputDir, 'temp_vframes');
        this.setTempFrameDir(tempFrameDir);

        for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
            const currentTime = frameIndex / fps;

            // Clear canvas
            this.ctx.fillStyle = '#000000';
            this.ctx.fillRect(0, 0, this.width, this.height);

            // Render frame
            await this.renderFrame(timeline.tracks, currentTime);

            // Save frame
            const framePath = path.join(outputDir, `frame_${String(frameIndex).padStart(5, '0')}.jpg`);
            const buffer = this.canvas.toBuffer('image/jpeg', { quality: 0.9 });
            fs.writeFileSync(framePath, buffer);

            // Report progress
            if (onProgress) {
                onProgress((frameIndex + 1) / totalFrames * 100);
            }

            // Log every 30 frames
            if (frameIndex % 30 === 0) {
                console.log(`[FrameRenderer] Frame ${frameIndex}/${totalFrames} (${((frameIndex / totalFrames) * 100).toFixed(1)}%)`);
            }
        }

        console.log(`[FrameRenderer] Completed ${totalFrames} frames`);

        // Cleanup temp video frames directory
        try {
            if (fs.existsSync(tempFrameDir)) {
                fs.rmSync(tempFrameDir, { recursive: true, force: true });
            }
        } catch (e) {
            console.warn('[FrameRenderer] Failed to cleanup temp frames dir:', e);
        }

        // Clear video frame cache
        this.clearVideoFrameCache();

        return totalFrames;
    }

    /**
     * Render a single frame with all active timeline items
     * Handles transitions between overlapping clips
     */
    async renderFrame(tracks: TrackData[], currentTime: number): Promise<number> {
        const renderItems = this.getRenderItems(tracks, currentTime);

        // Sort by layer (background first, then by z-index)
        renderItems.sort((a, b) => {
            if (a.item.isBackground && !b.item.isBackground) return -1;
            if (!a.item.isBackground && b.item.isBackground) return 1;
            return (a.item.layer || 0) - (b.item.layer || 0);
        });

        let renderedCount = 0;

        for (const renderItem of renderItems) {
            const { item, role, transition, transitionProgress } = renderItem;

            if (item.type === 'video' || item.type === 'image') {
                const success = await this.renderMediaItemWithTransition(
                    item, currentTime, role, transition, transitionProgress
                );
                if (success) renderedCount++;
            } else if (item.type === 'color') {
                this.renderColorItem(item);
                renderedCount++;
            } else if (item.type === 'text') {
                this.renderTextItem(item, currentTime);
                renderedCount++;
            }
        }

        return renderedCount;
    }

    /**
     * Get all items to render with transition information
     */
    private getRenderItems(tracks: TrackData[], currentTime: number): RenderItem[] {
        const renderItems: RenderItem[] = [];

        for (const track of tracks) {
            // Only video/overlay tracks have transitions
            if (track.type !== 'video' && track.type !== 'overlay') {
                // Non-video tracks: simple render of all active items
                const activeItems = track.items.filter(i =>
                    currentTime >= i.start && currentTime < i.start + i.duration
                );
                activeItems.forEach(item => {
                    renderItems.push({ item, track, role: 'main', transition: null, transitionProgress: 0 });
                });
                continue;
            }

            // Sort items by start time
            const sortedItems = [...track.items].sort((a, b) => a.start - b.start);

            // Find main item (the one playing at currentTime)
            const mainItemIndex = sortedItems.findIndex(i =>
                currentTime >= i.start && currentTime < i.start + i.duration
            );
            const mainItem = mainItemIndex !== -1 ? sortedItems[mainItemIndex] : null;

            // Find next item
            let nextItemIndex = -1;
            if (mainItem) {
                nextItemIndex = mainItemIndex + 1;
            } else {
                nextItemIndex = sortedItems.findIndex(i => i.start > currentTime);
            }
            const nextItem = (nextItemIndex !== -1 && nextItemIndex < sortedItems.length)
                ? sortedItems[nextItemIndex] : null;

            let isTransitioning = false;
            let transition: TimelineItemData['transition'] | null = null;
            let progress = 0;
            let outgoingItem: TimelineItemData | null = null;
            let incomingItem: TimelineItemData | null = null;

            // CHECK 1: Incoming Transition on Main Item
            if (mainItem && mainItem.transition && mainItem.transition.type !== 'none') {
                const t = mainItem.transition;
                const timing = t.timing || 'postfix';
                const timeIntoClip = currentTime - mainItem.start;

                let transStart = 0;
                if (timing === 'postfix') transStart = 0;
                else if (timing === 'overlap') transStart = -t.duration / 2;
                else if (timing === 'prefix') transStart = -t.duration;

                if (timeIntoClip >= transStart && timeIntoClip <= transStart + t.duration) {
                    isTransitioning = true;
                    transition = t;
                    progress = (timeIntoClip - transStart) / t.duration;
                    incomingItem = mainItem;
                    if (mainItemIndex > 0) outgoingItem = sortedItems[mainItemIndex - 1];
                }
            }

            // CHECK 2: Outgoing Transition on Next Item
            if (!isTransitioning && nextItem && nextItem.transition && nextItem.transition.type !== 'none') {
                const t = nextItem.transition;
                const timing = t.timing || 'postfix';
                const timeUntilNext = nextItem.start - currentTime;

                if (timing === 'prefix' || timing === 'overlap') {
                    let transDurationBeforeStart = 0;
                    if (timing === 'prefix') transDurationBeforeStart = t.duration;
                    if (timing === 'overlap') transDurationBeforeStart = t.duration / 2;

                    if (timeUntilNext <= transDurationBeforeStart) {
                        isTransitioning = true;
                        transition = t;
                        progress = (transDurationBeforeStart - timeUntilNext) / t.duration;
                        incomingItem = nextItem;
                        if (nextItemIndex > 0) outgoingItem = sortedItems[nextItemIndex - 1];
                    }
                }
            }

            // RENDER
            if (isTransitioning && transition && incomingItem) {
                if (outgoingItem) {
                    renderItems.push({
                        item: outgoingItem,
                        track,
                        role: 'outgoing',
                        transition,
                        transitionProgress: progress
                    });
                }
                renderItems.push({
                    item: incomingItem,
                    track,
                    role: 'main',
                    transition,
                    transitionProgress: progress
                });
            } else if (mainItem) {
                renderItems.push({
                    item: mainItem,
                    track,
                    role: 'main',
                    transition: null,
                    transitionProgress: 0
                });
            }
        }

        return renderItems;
    }

    /**
     * Render media item with transition effects
     */
    private async renderMediaItemWithTransition(
        item: TimelineItemData,
        currentTime: number,
        role: 'main' | 'outgoing',
        transition: TimelineItemData['transition'] | null,
        transitionProgress: number
    ): Promise<boolean> {
        // Calculate transition style
        let transitionStyle: TransitionStyle = {};
        if (transition && transition.type !== 'none') {
            transitionStyle = calculateTransitionStyle(
                transition.type,
                transitionProgress,
                role,
                transition.direction || 'left'
            );
        }

        return this.renderMediaItemWithStyle(item, currentTime, transitionStyle);
    }

    /**
     * Render media item with style (transition + animation + filters)
     */
    private async renderMediaItemWithStyle(
        item: TimelineItemData,
        currentTime: number,
        transitionStyle: TransitionStyle
    ): Promise<boolean> {
        // Load media (image or video frame)
        const img = await this.loadMediaFrame(item, currentTime);
        if (!img) return false;

        // Calculate bounds
        const { x, y, width, height } = this.calculateBounds(item, img);

        // Calculate animation style
        const animStyle = calculateAnimationStyle(item, currentTime);

        this.ctx.save();

        // Build filter string
        // Note: node-canvas has limited filter support - we'll handle what we can

        // Base transform
        let tx = x + width / 2;
        let ty = y + height / 2;

        // Transition translate
        if (transitionStyle.translateX) tx += (transitionStyle.translateX / 100) * this.width;
        if (transitionStyle.translateY) ty += (transitionStyle.translateY / 100) * this.height;

        // Animation translate
        if (animStyle.translateX) tx += animStyle.translateX;
        if (animStyle.translateY) ty += animStyle.translateY;

        this.ctx.translate(tx, ty);

        // Combined scale
        let scaleX = (transitionStyle.scale ?? 1) * (animStyle.scale ?? 1) * (animStyle.scaleX ?? 1);
        let scaleY = (transitionStyle.scale ?? 1) * (animStyle.scale ?? 1) * (animStyle.scaleY ?? 1);
        if (scaleX !== 1 || scaleY !== 1) {
            this.ctx.scale(scaleX, scaleY);
        }

        // Combined rotation
        const totalRotate = (transitionStyle.rotate ?? 0) + (animStyle.rotate ?? 0) + (item.rotation ?? 0);
        if (totalRotate) {
            this.ctx.rotate((totalRotate * Math.PI) / 180);
        }

        // Flip transforms
        if (item.flipH || item.flipV) {
            this.ctx.scale(item.flipH ? -1 : 1, item.flipV ? -1 : 1);
        }

        // Combined opacity
        const baseOpacity = (item.opacity ?? 100) / 100;
        const animOpacity = animStyle.opacity ?? 1;
        const transitionOpacity = transitionStyle.opacity ?? 1;
        this.ctx.globalAlpha = baseOpacity * animOpacity * transitionOpacity;

        // Clip for wipe transitions
        if (transitionStyle.clipX !== undefined || transitionStyle.clipWidth !== undefined) {
            this.ctx.beginPath();
            const clipX = (transitionStyle.clipX ?? 0) * width;
            const clipW = (transitionStyle.clipWidth ?? 1) * width;
            this.ctx.rect(-width / 2 + clipX, -height / 2, clipW, height);
            this.ctx.clip();
        }

        try {
            // Draw the image
            // Handle crop if specified
            const crop = item.crop || { x: 50, y: 50, zoom: 1 };
            const cropZoom = crop.zoom || 1;

            const sourceWidth = img.width;
            const sourceHeight = img.height;
            const visibleWidth = sourceWidth / cropZoom;
            const visibleHeight = sourceHeight / cropZoom;
            const maxOffsetX = sourceWidth - visibleWidth;
            const maxOffsetY = sourceHeight - visibleHeight;
            const srcX = (crop.x / 100) * maxOffsetX;
            const srcY = (crop.y / 100) * maxOffsetY;

            this.ctx.drawImage(
                img as any, // Type cast for node-canvas compatibility
                srcX, srcY, visibleWidth, visibleHeight,
                -width / 2, -height / 2, width, height
            );

            // Draw border if defined
            if (item.border && item.border.width > 0 && !item.isBackground) {
                this.ctx.strokeStyle = item.border.color || '#000000';
                this.ctx.lineWidth = item.border.width;
                this.ctx.strokeRect(-width / 2, -height / 2, width, height);
            }

            this.ctx.restore();
            return true;
        } catch (e) {
            console.error('[FrameRenderer] Error drawing media:', e);
            this.ctx.restore();
            return false;
        }
    }

    // Video frame cache - keyed by "videoPath:timestamp"
    private videoFrameCache = new Map<string, Image>();
    private tempFrameDir: string | null = null;

    /**
     * Set temp directory for video frame extraction
     */
    setTempFrameDir(dir: string): void {
        this.tempFrameDir = dir;
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    /**
     * Load media (image or video frame) for rendering
     */
    private async loadMediaFrame(item: TimelineItemData, currentTime: number): Promise<Image | null> {
        const src = item.localPath || item.src;
        if (!src) return null;

        // For images, use simple loading with cache
        if (item.type === 'image') {
            return this.loadImageFromPath(src);
        }

        // For videos, extract the specific frame
        if (item.type === 'video') {
            return this.extractVideoFrame(item, currentTime);
        }

        return null;
    }

    /**
     * Load an image from local path or URL
     */
    private async loadImageFromPath(src: string): Promise<Image | null> {
        // Check cache
        if (imageCache.has(src)) {
            return imageCache.get(src)!;
        }

        console.log(`[FrameRenderer] Loading image: ${src.substring(0, 80)}...`);

        try {
            const img = await loadImage(src);
            imageCache.set(src, img);
            console.log(`[FrameRenderer] ✅ Loaded image: ${img.width}x${img.height}`);
            return img;
        } catch (e) {
            console.error(`[FrameRenderer] ❌ Failed to load image: ${src}`, e);
            return null;
        }
    }

    /**
     * Extract a specific frame from a video at the given time
     */
    private async extractVideoFrame(item: TimelineItemData, currentTime: number): Promise<Image | null> {
        const videoPath = item.localPath || item.src;
        if (!videoPath) return null;

        // Calculate the time within the video (accounting for item start and trim)
        const itemTime = currentTime - item.start;
        const trimStart = item.trimStart || 0;
        const videoTime = trimStart + itemTime;

        // Round to nearest frame for caching (assuming 30fps granularity)
        const frameKey = `${videoPath}:${videoTime.toFixed(2)}`;

        // Check cache
        if (this.videoFrameCache.has(frameKey)) {
            return this.videoFrameCache.get(frameKey)!;
        }

        if (!this.tempFrameDir) {
            console.error('[FrameRenderer] Temp frame dir not set');
            return null;
        }

        // Generate unique frame filename
        const frameHash = Buffer.from(frameKey).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
        const framePath = path.join(this.tempFrameDir, `vframe_${frameHash}.jpg`);

        try {
            // Extract frame using FFmpeg
            await this.extractFrame(videoPath, videoTime, framePath);

            // Load the extracted frame
            const img = await loadImage(framePath);
            this.videoFrameCache.set(frameKey, img);

            // Clean up temp file after loading
            try {
                fs.unlinkSync(framePath);
            } catch (e) {
                // Ignore cleanup errors
            }

            return img;
        } catch (e) {
            console.error(`[FrameRenderer] Failed to extract video frame: ${videoPath} at ${videoTime}s`, e);
            return null;
        }
    }

    /**
     * Extract a single frame from video using FFmpeg
     */
    private extractFrame(videoPath: string, timestamp: number, outputPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!ffmpegPath) {
                return reject(new Error('FFmpeg binary not found'));
            }

            const args = [
                '-ss', String(Math.max(0, timestamp)),
                '-i', videoPath,
                '-vframes', '1',
                '-q:v', '2',
                '-y',
                outputPath
            ];

            const ffmpeg = spawn(ffmpegPath, args);
            let stderr = '';

            ffmpeg.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            ffmpeg.on('close', (code) => {
                if (code === 0 && fs.existsSync(outputPath)) {
                    resolve();
                } else {
                    reject(new Error(`FFmpeg frame extraction failed (code ${code}): ${stderr.slice(-200)}`));
                }
            });

            ffmpeg.on('error', reject);
        });
    }

    /**
     * Clear video frame cache to free memory
     */
    clearVideoFrameCache(): void {
        this.videoFrameCache.clear();
    }

    /**
     * Calculate item bounds on canvas with proper fit handling
     * Matches client-side FFmpegExportService.calculateBounds logic
     */
    private calculateBounds(item: TimelineItemData, img: Image): { x: number; y: number; width: number; height: number } {
        const canvasWidth = this.width;
        const canvasHeight = this.height;

        let width: number;
        let height: number;

        if (item.isBackground) {
            // Get media aspect ratio
            const mediaAspect = img.width / img.height || 1;
            const canvasAspect = canvasWidth / canvasHeight;
            const fit = item.fit || 'contain';

            if (fit === 'fill') {
                // Stretch to fill (ignores aspect ratio)
                width = canvasWidth;
                height = canvasHeight;
            } else if (fit === 'cover') {
                // Cover - fill canvas while maintaining aspect ratio (may crop)
                if (mediaAspect > canvasAspect) {
                    height = canvasHeight;
                    width = height * mediaAspect;
                } else {
                    width = canvasWidth;
                    height = width / mediaAspect;
                }
            } else {
                // Contain - fit inside canvas while maintaining aspect ratio (may letterbox)
                if (mediaAspect > canvasAspect) {
                    width = canvasWidth;
                    height = width / mediaAspect;
                } else {
                    height = canvasHeight;
                    width = height * mediaAspect;
                }
            }
        } else {
            // Non-background items use percentage-based sizing
            // Default to 50% if not specified
            width = item.width ? (item.width / 100) * canvasWidth : canvasWidth * 0.5;
            height = item.height ? (item.height / 100) * canvasHeight : canvasHeight * 0.5;
        }

        // Center the item based on x, y position percentages
        const x = (canvasWidth / 2) + ((item.x || 0) / 100) * canvasWidth - width / 2;
        const y = (canvasHeight / 2) + ((item.y || 0) / 100) * canvasHeight - height / 2;

        return { x, y, width, height };
    }

    /**
     * Render a solid color background
     */
    private renderColorItem(item: TimelineItemData): void {
        this.ctx.save();
        this.ctx.fillStyle = item.src || '#000000';
        this.ctx.globalAlpha = (item.opacity ?? 100) / 100;
        this.ctx.fillRect(0, 0, this.width, this.height);
        this.ctx.restore();
    }

    /**
     * Render text item with effects
     */
    private renderTextItem(item: TimelineItemData, currentTime: number): void {
        const text = item.name || '';
        if (!text) return;

        // Calculate animation
        const animStyle = calculateAnimationStyle(item, currentTime);

        this.ctx.save();

        // Position
        const xPct = item.x ?? 0;
        const yPct = item.y ?? 0;
        const x = (this.width / 2) + (xPct / 100) * this.width;
        const y = (this.height / 2) + (yPct / 100) * this.height;

        this.ctx.translate(x, y);

        // Animation transforms
        if (animStyle.scale) this.ctx.scale(animStyle.scale, animStyle.scale);
        if (animStyle.rotate) this.ctx.rotate((animStyle.rotate * Math.PI) / 180);
        if (animStyle.translateX || animStyle.translateY) {
            this.ctx.translate(animStyle.translateX || 0, animStyle.translateY || 0);
        }

        // Opacity
        const baseOpacity = (item.opacity ?? 100) / 100;
        const animOpacity = animStyle.opacity ?? 1;
        this.ctx.globalAlpha = baseOpacity * animOpacity;

        // Font setup
        const fontSize = item.fontSize || 40;
        const fontFamily = item.fontFamily || 'Arial';
        const fontWeight = item.fontWeight || 'normal';
        const fontStyle = item.fontStyle || 'normal';
        this.ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        // Text effect
        if (item.textEffect) {
            const effect = item.textEffect;
            if (effect.type === 'shadow') {
                this.ctx.shadowColor = effect.color || 'rgba(0,0,0,0.5)';
                this.ctx.shadowBlur = effect.intensity || 4;
                this.ctx.shadowOffsetX = effect.offset || 2;
                this.ctx.shadowOffsetY = effect.offset || 2;
            } else if (effect.type === 'outline') {
                this.ctx.strokeStyle = effect.color || '#000000';
                this.ctx.lineWidth = effect.intensity || 2;
                this.ctx.strokeText(text, 0, 0);
            }
        }

        // Draw text
        this.ctx.fillStyle = item.color || '#ffffff';
        this.ctx.fillText(text, 0, 0);

        this.ctx.restore();
    }

    /**
     * Clear media cache to free memory
     */
    static clearCache(): void {
        imageCache.clear();
    }
}

/**
 * Encode frames to video using FFmpeg
 */
export async function encodeFramesToVideo(
    framesDir: string,
    outputPath: string,
    settings: ExportSettings,
    audioInputs: Array<{ file: string; startTime: number; offset: number; duration: number }> = [],
    onProgress?: (progress: number) => void
): Promise<void> {
    return new Promise((resolve, reject) => {
        if (!ffmpegPath) {
            return reject(new Error('FFmpeg binary not found'));
        }

        const args: string[] = [
            '-y',
            '-framerate', String(settings.fps),
            '-i', path.join(framesDir, 'frame_%05d.jpg'),
        ];

        // Add audio inputs
        for (const audio of audioInputs) {
            args.push('-i', audio.file);
        }

        if (audioInputs.length > 0) {
            // Build audio filter for mixing
            const filterParts: string[] = [];
            for (let i = 0; i < audioInputs.length; i++) {
                const audio = audioInputs[i];
                const streamIdx = i + 1;
                const delayMs = Math.round(audio.startTime * 1000);
                filterParts.push(
                    `[${streamIdx}:a]atrim=start=${audio.offset}:duration=${audio.duration},asetpts=PTS-STARTPTS,adelay=${delayMs}|${delayMs}[a${i}]`
                );
            }
            const mixInputs = audioInputs.map((_, i) => `[a${i}]`).join('');
            filterParts.push(`${mixInputs}amix=inputs=${audioInputs.length}:duration=longest:dropout_transition=0[aout]`);

            // Use correct audio codec for format
            const isWebmFormat = outputPath.toLowerCase().endsWith('.webm');
            const audioCodec = isWebmFormat ? 'libopus' : 'aac';

            args.push(
                '-filter_complex', filterParts.join(';'),
                '-map', '0:v',
                '-map', '[aout]',
                '-c:a', audioCodec,
                '-b:a', '192k'
            );
        }

        // Video encoding settings - use correct codec for format
        const isWebm = outputPath.toLowerCase().endsWith('.webm');

        if (isWebm) {
            // WebM format - use VP9 codec
            args.push(
                '-c:v', 'libvpx-vp9',
                '-crf', settings.quality === 'high' ? '18' : settings.quality === 'medium' ? '28' : '35',
                '-b:v', '0',
                '-pix_fmt', 'yuv420p',
                outputPath
            );
        } else {
            // MP4/other formats - use H.264 codec
            args.push(
                '-c:v', 'libx264',
                '-preset', 'medium',
                '-crf', settings.quality === 'high' ? '18' : settings.quality === 'medium' ? '23' : '28',
                '-pix_fmt', 'yuv420p',
                '-movflags', '+faststart',
                outputPath
            );
        }

        console.log(`[FrameRenderer] Encoding video: ffmpeg ${args.join(' ')}`);

        const ffmpeg = spawn(ffmpegPath, args);
        let duration = 0;

        ffmpeg.stderr.on('data', (data) => {
            const str = data.toString();

            // Parse duration
            const durationMatch = str.match(/Duration: (\d+):(\d+):(\d+)/);
            if (durationMatch) {
                const [, h, m, s] = durationMatch;
                duration = parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s);
            }

            // Parse progress
            const timeMatch = str.match(/time=(\d+):(\d+):(\d+)/);
            if (timeMatch && duration > 0 && onProgress) {
                const [, h, m, s] = timeMatch;
                const currentTime = parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s);
                onProgress(Math.min(100, (currentTime / duration) * 100));
            }
        });

        ffmpeg.on('close', (code) => {
            if (code === 0) {
                console.log(`[FrameRenderer] Encoding complete: ${outputPath}`);
                resolve();
            } else {
                reject(new Error(`FFmpeg exited with code ${code}`));
            }
        });

        ffmpeg.on('error', reject);
    });
}
