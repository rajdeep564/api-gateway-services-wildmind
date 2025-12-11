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
import { applyItemFilters, Adjustments, DEFAULT_ADJUSTMENTS } from './ImageFilters';

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

        // Animation translate - convert from percentages to pixels
        // animStyle.translateX/Y are percentage values (e.g., -100 to +100)
        if (animStyle.translateX) tx += (animStyle.translateX / 100) * this.width;
        if (animStyle.translateY) ty += (animStyle.translateY / 100) * this.height;

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

        // Apply clip path for transition effects
        this.applyClipPath(transitionStyle, width, height);

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

            // DEBUG: Log ALL media items to see what data we receive
            console.log(`[FrameRenderer] Item "${item.name}" filter="${item.filter}" adjustments=`, item.adjustments);

            // Apply filters and adjustments AFTER restore (in screen coordinates)
            // This processes the pixels that were just drawn
            const hasFilter = item.filter && item.filter !== 'none';
            const hasAdjustments = item.adjustments && Object.values(item.adjustments).some(v => v !== 0 && v !== undefined);

            if (hasFilter || hasAdjustments) {
                console.log(`[FrameRenderer] APPLYING filters/adjustments for "${item.name}"`);

                // Calculate the screen bounds of the drawn item
                const screenX = x;
                const screenY = y;
                const screenWidth = width;
                const screenHeight = height;

                applyItemFilters(
                    this.ctx,
                    this.width,
                    this.height,
                    screenX,
                    screenY,
                    screenWidth,
                    screenHeight,
                    item.filter || 'none',
                    item.adjustments as Adjustments | undefined
                );
            }

            return true;
        } catch (e) {
            console.error('[FrameRenderer] Error drawing media:', e);
            this.ctx.restore();
            return false;
        }
    }

    /**
     * Apply clip path for transition effects
     * Handles various clip shapes: circle, inset, polygon, arc, blinds, checker
     */
    private applyClipPath(style: TransitionStyle, width: number, height: number): void {
        // Handle legacy clipX/clipWidth for backward compatibility
        if (style.clipX !== undefined || style.clipWidth !== undefined) {
            this.ctx.beginPath();
            const clipX = (style.clipX ?? 0) * width;
            const clipW = (style.clipWidth ?? 1) * width;
            this.ctx.rect(-width / 2 + clipX, -height / 2, clipW, height);
            this.ctx.clip();
            return;
        }

        // Handle new shape-based clipping
        if (!style.clipShape || style.clipShape === 'none') return;

        const halfW = width / 2;
        const halfH = height / 2;

        this.ctx.beginPath();

        switch (style.clipShape) {
            case 'circle': {
                // Circle reveal from center
                const radius = (style.clipRadius ?? 0) * Math.sqrt(width * width + height * height) / 2;
                this.ctx.arc(0, 0, Math.max(1, radius), 0, Math.PI * 2);
                break;
            }
            case 'rect': {
                // Simple rectangle (for backward compatibility)
                this.ctx.rect(-halfW, -halfH, width, height);
                break;
            }
            case 'inset': {
                // Inset rectangle from edges
                const insetT = (style.clipInsetTop ?? 0) * height;
                const insetR = (style.clipInsetRight ?? 0) * width;
                const insetB = (style.clipInsetBottom ?? 0) * height;
                const insetL = (style.clipInsetLeft ?? 0) * width;
                this.ctx.rect(
                    -halfW + insetL,
                    -halfH + insetT,
                    width - insetL - insetR,
                    height - insetT - insetB
                );
                break;
            }
            case 'polygon': {
                // Custom polygon with normalized points (0-1)
                const points = style.clipPoints;
                if (points && points.length >= 3) {
                    this.ctx.moveTo(
                        (points[0][0] - 0.5) * width,
                        (points[0][1] - 0.5) * height
                    );
                    for (let i = 1; i < points.length; i++) {
                        this.ctx.lineTo(
                            (points[i][0] - 0.5) * width,
                            (points[i][1] - 0.5) * height
                        );
                    }
                    this.ctx.closePath();
                }
                break;
            }
            case 'arc': {
                // Pie/wedge shape from center (for clock-wipe, radial-wipe)
                const startAngle = ((style.clipArcStart ?? 0) * Math.PI) / 180;
                const endAngle = ((style.clipArcEnd ?? 360) * Math.PI) / 180;
                const radius = Math.sqrt(width * width + height * height);
                this.ctx.moveTo(0, 0);
                this.ctx.arc(0, 0, radius, startAngle, endAngle);
                this.ctx.closePath();
                break;
            }
            case 'blinds': {
                // Venetian blinds / stripes pattern
                const stripes = style.clipStripes ?? 10;
                const progress = style.clipRadius ?? 0; // Use clipRadius as progress
                const stripeHeight = height / stripes;
                for (let i = 0; i < stripes; i++) {
                    const y = -halfH + i * stripeHeight;
                    const visibleHeight = stripeHeight * progress;
                    this.ctx.rect(-halfW, y, width, visibleHeight);
                }
                break;
            }
            case 'checker': {
                // Checkerboard pattern
                const size = (style.clipCheckerSize ?? 0.1) * Math.min(width, height);
                const progress = style.clipRadius ?? 0; // Use clipRadius as progress
                const cols = Math.ceil(width / size);
                const rows = Math.ceil(height / size);
                const threshold = progress * (cols + rows); // Diagonal reveal

                for (let row = 0; row < rows; row++) {
                    for (let col = 0; col < cols; col++) {
                        // Checkerboard pattern - only draw alternating squares
                        if ((row + col) % 2 === 0) {
                            const diagonalIndex = row + col;
                            if (diagonalIndex < threshold) {
                                this.ctx.rect(
                                    -halfW + col * size,
                                    -halfH + row * size,
                                    size,
                                    size
                                );
                            }
                        }
                    }
                }
                break;
            }
        }

        this.ctx.clip();
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
     * Render a solid color or gradient background
     */
    private renderColorItem(item: TimelineItemData): void {
        this.ctx.save();
        this.ctx.globalAlpha = (item.opacity ?? 100) / 100;

        const colorValue = item.src || '#000000';

        // Check if it's a gradient
        if (colorValue.includes('linear-gradient')) {
            // Parse CSS linear-gradient: linear-gradient(to right, #ff7e5f, #feb47b)
            const gradientMatch = colorValue.match(/linear-gradient\(\s*(to\s+\w+|[\d.]+deg)?\s*,?\s*(.+)\)/i);

            if (gradientMatch) {
                const direction = gradientMatch[1] || 'to right';
                const colorStops = gradientMatch[2];

                // Determine gradient direction
                let x0 = 0, y0 = 0, x1 = this.width, y1 = 0;

                if (direction.includes('right')) {
                    x0 = 0; y0 = 0; x1 = this.width; y1 = 0;
                } else if (direction.includes('left')) {
                    x0 = this.width; y0 = 0; x1 = 0; y1 = 0;
                } else if (direction.includes('bottom')) {
                    x0 = 0; y0 = 0; x1 = 0; y1 = this.height;
                } else if (direction.includes('top')) {
                    x0 = 0; y0 = this.height; x1 = 0; y1 = 0;
                } else if (direction.includes('deg')) {
                    // Handle degree-based directions
                    const angle = parseFloat(direction) * Math.PI / 180;
                    const cx = this.width / 2;
                    const cy = this.height / 2;
                    const len = Math.max(this.width, this.height);
                    x0 = cx - Math.sin(angle) * len / 2;
                    y0 = cy - Math.cos(angle) * len / 2;
                    x1 = cx + Math.sin(angle) * len / 2;
                    y1 = cy + Math.cos(angle) * len / 2;
                }

                const gradient = this.ctx.createLinearGradient(x0, y0, x1, y1);

                // Parse color stops: "#ff7e5f, #feb47b" or "#ff7e5f 0%, #feb47b 100%"
                const colors = colorStops.split(',').map(s => s.trim());
                colors.forEach((colorStr, index) => {
                    // Check if color has a percentage position
                    const posMatch = colorStr.match(/(.+?)\s+([\d.]+%)/);
                    if (posMatch) {
                        const color = posMatch[1].trim();
                        const pos = parseFloat(posMatch[2]) / 100;
                        gradient.addColorStop(pos, color);
                    } else {
                        // Distribute evenly
                        const pos = colors.length > 1 ? index / (colors.length - 1) : 0;
                        gradient.addColorStop(pos, colorStr);
                    }
                });

                this.ctx.fillStyle = gradient;
            } else {
                // Fallback if parsing fails
                this.ctx.fillStyle = '#000000';
            }
        } else if (colorValue.includes('radial-gradient')) {
            // Parse radial gradient: radial-gradient(circle, #ff7e5f, #feb47b)
            const gradientMatch = colorValue.match(/radial-gradient\(\s*(circle|ellipse)?\s*,?\s*(.+)\)/i);

            if (gradientMatch) {
                const colorStops = gradientMatch[2];
                const cx = this.width / 2;
                const cy = this.height / 2;
                const radius = Math.max(this.width, this.height) / 2;

                const gradient = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);

                const colors = colorStops.split(',').map(s => s.trim());
                colors.forEach((colorStr, index) => {
                    const posMatch = colorStr.match(/(.+?)\s+([\d.]+%)/);
                    if (posMatch) {
                        const color = posMatch[1].trim();
                        const pos = parseFloat(posMatch[2]) / 100;
                        gradient.addColorStop(pos, color);
                    } else {
                        const pos = colors.length > 1 ? index / (colors.length - 1) : 0;
                        gradient.addColorStop(pos, colorStr);
                    }
                });

                this.ctx.fillStyle = gradient;
            } else {
                this.ctx.fillStyle = '#000000';
            }
        } else {
            // Solid color
            this.ctx.fillStyle = colorValue;
        }

        this.ctx.fillRect(0, 0, this.width, this.height);
        this.ctx.restore();
    }

    /**
     * Render text item with all effects (matches client-side getTextEffectStyle)
     * Supports: shadow, outline, neon, glitch, splice, echo, hollow, lift, background
     * Also supports: textAlign, verticalAlign, textTransform, multi-line text, listType
     */
    private renderTextItem(item: TimelineItemData, currentTime: number): void {
        let text = item.name || '';
        if (!text) return;

        // Apply text transform
        if (item.textTransform === 'uppercase') text = text.toUpperCase();
        else if (item.textTransform === 'lowercase') text = text.toLowerCase();

        // Calculate animation
        const animStyle = calculateAnimationStyle(item, currentTime);

        this.ctx.save();

        // Font setup
        const fontSize = item.fontSize || 40;
        const fontFamily = item.fontFamily || 'Arial';
        const fontWeight = item.fontWeight || 'normal';
        const fontStyle = item.fontStyle || 'normal';
        const lineHeight = fontSize * 1.4;
        this.ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;

        // Calculate item bounds (matching client-side logic)
        const itemWidth = item.width ? (item.width / 100) * this.width : this.width * 0.5;
        const itemHeight = item.height ? (item.height / 100) * this.height : this.height * 0.5;

        // Match client-side getItemPositionAndTransform logic exactly:
        // Client uses CSS with left/right/top/bottom and translate
        // For text items:
        //   textAlign 'left': left = 50 + x%, translateX = 0%
        //   textAlign 'right': right = 50 - x%, translateX = 0%
        //   textAlign 'center': left = 50 + x%, translateX = -50%
        //   verticalAlign 'top': top = 50 + y%, translateY = 0%
        //   verticalAlign 'bottom': bottom = 50 - y%, translateY = 0%
        //   verticalAlign 'middle': top = 50 + y%, translateY = -50%

        const textAlign = item.textAlign || 'center';
        const verticalAlign = item.verticalAlign || 'middle';

        // Calculate X position based on text alignment
        let textX: number;
        let xOffset = 0; // For translation offset
        if (textAlign === 'left') {
            // Position from left edge: 50% + x% of canvas, no translate offset
            textX = (this.width / 2) + ((item.x ?? 0) / 100) * this.width;
            this.ctx.textAlign = 'left';
        } else if (textAlign === 'right') {
            // Position from right edge: 50% - x% from right = canvas - (50% - x%)
            textX = this.width - ((50 - (item.x ?? 0)) / 100) * this.width;
            this.ctx.textAlign = 'right';
        } else {
            // Center: 50% + x%, then translate -50% of item width
            textX = (this.width / 2) + ((item.x ?? 0) / 100) * this.width;
            this.ctx.textAlign = 'center';
        }

        this.ctx.textBaseline = 'top';

        // Split text into lines
        const lines = text.split('\n');
        const totalTextHeight = lines.length * lineHeight;

        // Calculate Y position based on vertical alignment
        let textY: number;
        if (verticalAlign === 'top') {
            // Position from top: 50% + y%
            textY = (this.height / 2) + ((item.y ?? 0) / 100) * this.height;
        } else if (verticalAlign === 'bottom') {
            // Position from bottom: 50% - y% from bottom, align to bottom of text
            textY = this.height - ((50 - (item.y ?? 0)) / 100) * this.height - totalTextHeight;
        } else {
            // Middle: center vertically
            textY = (this.height / 2) + ((item.y ?? 0) / 100) * this.height - totalTextHeight / 2;
        }

        // Apply transforms at the text position
        this.ctx.translate(textX, textY + totalTextHeight / 2);

        // Item rotation
        if (item.rotation) {
            this.ctx.rotate((item.rotation * Math.PI) / 180);
        }

        // Animation transforms - convert percentage-based values to pixels
        const animTranslateX = (animStyle.translateX ?? 0) / 100 * this.width;
        const animTranslateY = (animStyle.translateY ?? 0) / 100 * this.height;

        if (animTranslateX !== 0 || animTranslateY !== 0) {
            this.ctx.translate(animTranslateX, animTranslateY);
        }

        // Handle scale with independent scaleX/scaleY support
        const scaleX = (animStyle.scale ?? 1) * (animStyle.scaleX ?? 1);
        const scaleY = (animStyle.scale ?? 1) * (animStyle.scaleY ?? 1);
        if (scaleX !== 1 || scaleY !== 1) {
            this.ctx.scale(scaleX, scaleY);
        }

        // Animation rotation
        if (animStyle.rotate) {
            this.ctx.rotate((animStyle.rotate * Math.PI) / 180);
        }

        // Opacity
        const baseOpacity = (item.opacity ?? 100) / 100;
        const animOpacity = animStyle.opacity ?? 1;
        this.ctx.globalAlpha = baseOpacity * animOpacity;

        const itemColor = item.color || '#ffffff';
        const effect = item.textEffect;

        // Calculate effect parameters (matches client-side getTextEffectStyle)
        const scale = fontSize / 40; // Scale effects relative to font size
        const effColor = effect?.color || '#000000';
        const intensity = effect?.intensity ?? 50;
        const offset = effect?.offset ?? 50;
        const dist = (offset / 100) * 20 * scale; // 0 to 20px * scale
        const blur = (intensity / 100) * 20 * scale; // 0 to 20px * scale

        // Calculate Y positions for each line (centered around origin)
        const lineY = (lineIndex: number) => (lineIndex - (lines.length - 1) / 2) * lineHeight;

        // Helper to draw a line with effects
        const drawLine = (lineText: string, yPos: number) => {
            if (!effect || effect.type === 'none') {
                // No effect - simple text
                this.ctx.fillStyle = itemColor;
                this.ctx.fillText(lineText, 0, yPos);
            } else {
                switch (effect.type) {
                    case 'shadow':
                        this.ctx.shadowColor = effColor;
                        this.ctx.shadowBlur = blur;
                        this.ctx.shadowOffsetX = dist;
                        this.ctx.shadowOffsetY = dist;
                        this.ctx.fillStyle = itemColor;
                        this.ctx.fillText(lineText, 0, yPos);
                        break;

                    case 'lift':
                        this.ctx.shadowColor = 'rgba(0,0,0,0.5)';
                        this.ctx.shadowBlur = blur + 10 * scale;
                        this.ctx.shadowOffsetX = 0;
                        this.ctx.shadowOffsetY = dist * 0.5 + 4 * scale;
                        this.ctx.fillStyle = itemColor;
                        this.ctx.fillText(lineText, 0, yPos);
                        break;

                    case 'hollow':
                        this.ctx.strokeStyle = itemColor;
                        this.ctx.lineWidth = ((intensity / 100) * 3 + 1) * scale;
                        this.ctx.strokeText(lineText, 0, yPos);
                        break;

                    case 'splice':
                        this.ctx.fillStyle = effColor;
                        this.ctx.fillText(lineText, dist + 2 * scale, yPos + dist + 2 * scale);
                        this.ctx.strokeStyle = itemColor;
                        this.ctx.lineWidth = ((intensity / 100) * 3 + 1) * scale;
                        this.ctx.strokeText(lineText, 0, yPos);
                        break;

                    case 'outline':
                        this.ctx.strokeStyle = effColor;
                        this.ctx.lineWidth = ((intensity / 100) * 3 + 1) * scale;
                        this.ctx.strokeText(lineText, 0, yPos);
                        this.ctx.fillStyle = itemColor;
                        this.ctx.fillText(lineText, 0, yPos);
                        break;

                    case 'echo':
                        this.ctx.globalAlpha = baseOpacity * animOpacity * 0.2;
                        this.ctx.fillStyle = effColor;
                        this.ctx.fillText(lineText, dist * 3, yPos + dist * 3);
                        this.ctx.globalAlpha = baseOpacity * animOpacity * 0.4;
                        this.ctx.fillText(lineText, dist * 2, yPos + dist * 2);
                        this.ctx.globalAlpha = baseOpacity * animOpacity * 0.8;
                        this.ctx.fillText(lineText, dist, yPos + dist);
                        this.ctx.globalAlpha = baseOpacity * animOpacity;
                        this.ctx.fillStyle = itemColor;
                        this.ctx.fillText(lineText, 0, yPos);
                        break;

                    case 'glitch':
                        const gOff = ((offset / 100) * 5 + 2) * scale;
                        this.ctx.fillStyle = '#00ffff';
                        this.ctx.fillText(lineText, -gOff, yPos - gOff);
                        this.ctx.fillStyle = '#ff00ff';
                        this.ctx.fillText(lineText, gOff, yPos + gOff);
                        this.ctx.fillStyle = itemColor;
                        this.ctx.fillText(lineText, 0, yPos);
                        break;

                    case 'neon':
                        const neonInt = intensity * 0.1 * scale;
                        this.ctx.shadowColor = effColor;
                        this.ctx.shadowBlur = neonInt * 4;
                        this.ctx.fillStyle = itemColor || '#ffffff';
                        this.ctx.fillText(lineText, 0, yPos);
                        this.ctx.shadowBlur = neonInt * 2;
                        this.ctx.fillText(lineText, 0, yPos);
                        this.ctx.shadowBlur = neonInt;
                        this.ctx.fillText(lineText, 0, yPos);
                        break;

                    case 'background':
                        const metrics = this.ctx.measureText(lineText);
                        const textWidth = metrics.width;
                        const textHeight = fontSize * 1.2;
                        const padX = 8 * scale;
                        const padY = 4 * scale;
                        // Calculate background X position based on text alignment
                        let bgX = -textWidth / 2 - padX;
                        if (this.ctx.textAlign === 'left') bgX = -padX;
                        else if (this.ctx.textAlign === 'right') bgX = -textWidth - padX;
                        this.ctx.fillStyle = effColor;
                        this.ctx.fillRect(bgX, yPos - textHeight / 2 - padY, textWidth + padX * 2, textHeight + padY * 2);
                        this.ctx.fillStyle = itemColor;
                        this.ctx.fillText(lineText, 0, yPos);
                        break;

                    default:
                        this.ctx.fillStyle = itemColor;
                        this.ctx.fillText(lineText, 0, yPos);
                }
            }
        };

        // Draw each line with list formatting
        for (let i = 0; i < lines.length; i++) {
            let lineText = lines[i];
            // Apply list formatting
            if (item.listType === 'bullet') lineText = '• ' + lineText;
            else if (item.listType === 'number') lineText = `${i + 1}. ` + lineText;

            drawLine(lineText, lineY(i));

            // Clear shadow for next line
            this.ctx.shadowBlur = 0;
            this.ctx.shadowOffsetX = 0;
            this.ctx.shadowOffsetY = 0;
        }

        // Draw text decoration (underline/strikethrough) if needed
        if (item.textDecoration && item.textDecoration !== 'none') {
            this.ctx.strokeStyle = itemColor;
            this.ctx.lineWidth = Math.max(1, fontSize / 20);
            for (let i = 0; i < lines.length; i++) {
                let lineText = lines[i];
                if (item.listType === 'bullet') lineText = '• ' + lineText;
                else if (item.listType === 'number') lineText = `${i + 1}. ` + lineText;

                const metrics = this.ctx.measureText(lineText);
                const textWidth = metrics.width;
                const yPos = lineY(i);

                // Calculate line X based on text alignment
                let lineStartX = -textWidth / 2;
                if (this.ctx.textAlign === 'left') lineStartX = 0;
                else if (this.ctx.textAlign === 'right') lineStartX = -textWidth;

                this.ctx.beginPath();
                if (item.textDecoration === 'underline') {
                    const underlineY = yPos + fontSize * 0.1;
                    this.ctx.moveTo(lineStartX, underlineY);
                    this.ctx.lineTo(lineStartX + textWidth, underlineY);
                } else if (item.textDecoration === 'line-through') {
                    const strikeY = yPos - fontSize * 0.2;
                    this.ctx.moveTo(lineStartX, strikeY);
                    this.ctx.lineTo(lineStartX + textWidth, strikeY);
                }
                this.ctx.stroke();
            }
        }

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
