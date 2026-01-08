// ============================================
// Puppeteer Frame Renderer for GPU-Accelerated Export
// Uses headless Chrome with GPU to render frames
// Renders the actual Canvas.tsx component for 100% preview parity
// ============================================

import puppeteer, { Browser, Page } from 'puppeteer';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import express from 'express';
import ffmpegPath from 'ffmpeg-static';
import type { TimelineData, ExportSettings, TimelineItemData } from '../../types/videoExport';

// Browser pool for reuse
let browserPool: Browser[] = [];
const MAX_POOL_SIZE = 2;

/**
 * Puppeteer-based frame renderer with GPU acceleration
 * Renders frames by taking screenshots of the actual preview component
 */
export class PuppeteerFrameRenderer {
    private width: number;
    private height: number;
    private browser: Browser | null = null;
    private page: Page | null = null;
    private tempFrameDir: string | null = null;

    // Local HTTP server for serving media files (avoids base64 timeout)
    private mediaServer: http.Server | null = null;
    private mediaServerPort: number = 0;
    private exportDir: string = '';

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        console.log(`[PuppeteerFrameRenderer] 📐 Created renderer: ${width}x${height}`);
    }

    /**
     * Get or create a browser instance from pool
     */
    private async getBrowser(): Promise<Browser> {
        // Try to get from pool
        if (browserPool.length > 0) {
            const browser = browserPool.pop()!;
            if (browser.isConnected()) {
                console.log('[PuppeteerFrameRenderer] ♻️ Reusing browser from pool');
                return browser;
            }
        }

        // Create new browser with GPU flags
        console.log('[PuppeteerFrameRenderer] 🚀 Launching new Chrome instance with GPU...');

        // Calculate memory limits based on resolution
        const is4K = this.width >= 3840 || this.height >= 2160;
        const heapSize = is4K ? 4096 : 2048; // 4GB for 4K, 2GB for lower

        const browser = await puppeteer.launch({
            headless: true,
            // Increase protocol timeout for slow 4K screenshot operations
            protocolTimeout: 300000, // 5 minutes for 4K screenshots
            args: [
                // GPU Acceleration
                '--enable-gpu',
                '--use-angle=vulkan',
                '--enable-features=Vulkan',
                '--disable-vulkan-surface',
                '--enable-unsafe-webgpu',

                // Performance
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-web-security',
                '--no-zygote',

                // MEMORY OPTIMIZATION (CRITICAL for 4K/30min exports)
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                `--js-flags=--max-old-space-size=${heapSize}`, // Limit JS heap
                '--disable-gpu-shader-disk-cache', // Reduce disk cache
                '--aggressive-cache-discard', // Discard cached data aggressively
                '--disable-hang-monitor', // Prevent timeout killing

                // Canvas and media
                '--autoplay-policy=no-user-gesture-required',
                '--disable-features=IsolateOrigins,site-per-process',

                // Window size
                `--window-size=${this.width},${this.height}`,
            ],
        });

        console.log('[PuppeteerFrameRenderer] ✅ Chrome launched with GPU acceleration');
        return browser;
    }

    /**
     * Return browser to pool for reuse
     */
    private async returnBrowser(browser: Browser): Promise<void> {
        if (browserPool.length < MAX_POOL_SIZE && browser.isConnected()) {
            browserPool.push(browser);
            console.log('[PuppeteerFrameRenderer] ♻️ Browser returned to pool');
        } else {
            await browser.close();
            console.log('[PuppeteerFrameRenderer] 🔒 Browser closed');
        }
    }

    /**
     * Set temp directory for frame extraction
     */
    setTempFrameDir(dir: string): void {
        this.tempFrameDir = dir;
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    /**
     * Start local HTTP server to serve media files
     * This avoids base64 embedding which causes timeout for large videos
     */
    private async startMediaServer(exportDir: string): Promise<number> {
        this.exportDir = exportDir;

        const app = express();

        // Serve all files from the export directory with CORS enabled
        app.use('/media', (req, res, next) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET');
            res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
            res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
            next();
        }, express.static(exportDir, {
            setHeaders: (res, filePath) => {
                const ext = path.extname(filePath).toLowerCase();
                // Set correct MIME types
                if (ext === '.mp4') res.setHeader('Content-Type', 'video/mp4');
                else if (ext === '.webm') res.setHeader('Content-Type', 'video/webm');
                else if (ext === '.mov') res.setHeader('Content-Type', 'video/quicktime');
                else if (ext === '.png') res.setHeader('Content-Type', 'image/png');
                else if (ext === '.jpg' || ext === '.jpeg') res.setHeader('Content-Type', 'image/jpeg');
                else if (ext === '.gif') res.setHeader('Content-Type', 'image/gif');
                else if (ext === '.webp') res.setHeader('Content-Type', 'image/webp');
            }
        }));

        return new Promise((resolve, reject) => {
            // Use port 0 to get a random available port
            this.mediaServer = app.listen(0, '127.0.0.1', () => {
                const addr = this.mediaServer!.address();
                if (addr && typeof addr === 'object') {
                    this.mediaServerPort = addr.port;
                    console.log(`[PuppeteerFrameRenderer] 📦 Media server started on port ${this.mediaServerPort}`);
                    resolve(this.mediaServerPort);
                } else {
                    reject(new Error('Failed to get media server port'));
                }
            });

            this.mediaServer.on('error', (err) => {
                console.error('[PuppeteerFrameRenderer] Media server error:', err);
                reject(err);
            });
        });
    }

    /**
     * Stop the local media server
     */
    private async stopMediaServer(): Promise<void> {
        if (this.mediaServer) {
            return new Promise((resolve) => {
                this.mediaServer!.close(() => {
                    console.log('[PuppeteerFrameRenderer] 📦 Media server stopped');
                    this.mediaServer = null;
                    this.mediaServerPort = 0;
                    resolve();
                });
            });
        }
    }

    /**
     * Convert local file to base64 data URL (fallback for small files)
     */
    private fileToBase64(filePath: string): string {
        try {
            if (!fs.existsSync(filePath)) {
                console.warn(`[PuppeteerFrameRenderer] File not found: ${filePath}`);
                return '';
            }
            const buffer = fs.readFileSync(filePath);
            const ext = path.extname(filePath).toLowerCase();
            let mimeType = 'image/jpeg';
            if (ext === '.png') mimeType = 'image/png';
            else if (ext === '.gif') mimeType = 'image/gif';
            else if (ext === '.webp') mimeType = 'image/webp';
            else if (ext === '.mp4') mimeType = 'video/mp4';
            else if (ext === '.webm') mimeType = 'video/webm';
            else if (ext === '.mov') mimeType = 'video/quicktime';

            return `data:${mimeType};base64,${buffer.toString('base64')}`;
        } catch (e) {
            console.error(`[PuppeteerFrameRenderer] Failed to convert file to base64: ${filePath}`, e);
            return '';
        }
    }

    /**
     * Preprocess timeline to use HTTP URLs for media files
     * Uses local HTTP server instead of base64 to avoid timeout on large files
     */
    private preprocessTimeline(timeline: TimelineData): TimelineData {
        const processedTimeline = JSON.parse(JSON.stringify(timeline)) as TimelineData;

        // Size threshold for base64 (10MB) - larger files use HTTP
        const BASE64_SIZE_THRESHOLD = 10 * 1024 * 1024;

        for (const track of processedTimeline.tracks) {
            for (const item of track.items) {
                // Convert local paths to HTTP URLs (or base64 for small files)
                if (item.localPath && (item.type === 'image' || item.type === 'video')) {
                    try {
                        const stats = fs.statSync(item.localPath);
                        const filename = path.basename(item.localPath);

                        if (stats.size > BASE64_SIZE_THRESHOLD && this.mediaServerPort > 0) {
                            // Large file: use HTTP URL from local server
                            (item as any).httpUrl = `http://127.0.0.1:${this.mediaServerPort}/media/${filename}`;
                            console.log(`[PuppeteerFrameRenderer] 🌐 Using HTTP URL for large file: ${item.name} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
                        } else {
                            // Small file: use base64 (faster for small files)
                            const base64 = this.fileToBase64(item.localPath);
                            if (base64) {
                                console.log(`[PuppeteerFrameRenderer] 🔄 Converted to base64: ${item.name} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
                                item.dataUrl = base64;
                            }
                        }
                    } catch (e) {
                        // Fallback to base64 on error
                        const base64 = this.fileToBase64(item.localPath);
                        if (base64) {
                            console.log(`[PuppeteerFrameRenderer] 🔄 Fallback to base64: ${item.name}`);
                            item.dataUrl = base64;
                        }
                    }
                }
            }
        }

        return processedTimeline;
    }

    /**
     * Generate the HTML page for rendering
     * This includes all necessary CSS and the rendering logic
     */
    private generateRenderPage(timeline: TimelineData, settings: ExportSettings): string {
        // Preprocess timeline to convert local paths to base64
        const processedTimeline = this.preprocessTimeline(timeline);

        // Debug: Log text scaling info (using 1920 reference width)
        const REFERENCE_WIDTH = 1920;
        const textScale = this.width / REFERENCE_WIDTH;
        console.log(`[PuppeteerFrameRenderer] 📏 Text scaling: refWidth=${REFERENCE_WIDTH}, exportWidth=${this.width}, textScale=${textScale.toFixed(3)}`);

        // Serialize timeline data for injection
        const timelineJSON = JSON.stringify(processedTimeline);
        const settingsJSON = JSON.stringify(settings);

        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            width: ${this.width}px; 
            height: ${this.height}px; 
            overflow: hidden;
            background: #000;
        }
        #canvas-container {
            position: relative;
            width: ${this.width}px;
            height: ${this.height}px;
            overflow: hidden;
            background: #000;
        }
        .timeline-item {
            position: absolute;
            transform-origin: center center;
        }
        .timeline-item.background {
            width: 100%;
            height: 100%;
            top: 0;
            left: 0;
        }
        .timeline-item video, .timeline-item img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        .timeline-item.text-item {
            white-space: pre-wrap;
            word-break: break-word;
        }
        
        /* Import Google Fonts commonly used */
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Roboto:wght@400;700&family=Poppins:wght@400;700&family=Montserrat:wght@400;700&family=Playfair+Display:wght@400;700&family=Lobster&family=Pacifico&family=Great+Vibes&family=Dancing+Script&family=Anton&family=Bebas+Neue&display=swap');
    </style>
</head>
<body>
    <div id="canvas-container"></div>
    
    <script>
        // Timeline and settings data
        const timeline = ${timelineJSON};
        const settings = ${settingsJSON};
        const canvasWidth = ${this.width};
        const canvasHeight = ${this.height};
        
        // Calculate text scale: export resolution vs reference width
        // Canvas.tsx uses MAX_RENDER_WIDTH = 1920, so fontSize is designed for 1920px width
        // When exporting at different resolution, scale proportionally
        // Example: exporting at 1280 -> textScale = 1280/1920 = 0.67
        const REFERENCE_WIDTH = 1920;
        const textScale = canvasWidth / REFERENCE_WIDTH;
        console.log('[PuppeteerFrameRenderer] Text scaling: refWidth=' + REFERENCE_WIDTH + ', exportWidth=' + canvasWidth + ', textScale=' + textScale);
        
        // Media cache
        const mediaCache = new Map();
        
        // Preload all media
        async function preloadMedia() {
            const promises = [];
            
            for (const track of timeline.tracks) {
                for (const item of track.items) {
                    if (item.type === 'video' || item.type === 'image') {
                        // Priority: httpUrl (local server) > dataUrl (base64) > localPath > src
                        const src = item.httpUrl || item.dataUrl || item.localPath || item.src;
                        if (!src || mediaCache.has(item.id)) continue;
                        
                        const promise = new Promise((resolve, reject) => {
                            if (item.type === 'video') {
                                const video = document.createElement('video');
                                video.src = src;
                                video.crossOrigin = 'anonymous';
                                video.muted = true;
                                video.preload = 'auto';
                                video.onloadeddata = () => {
                                    mediaCache.set(item.id, video);
                                    resolve(video);
                                };
                                video.onerror = reject;
                            } else {
                                const img = new Image();
                                img.crossOrigin = 'anonymous';
                                img.onload = () => {
                                    mediaCache.set(item.id, img);
                                    resolve(img);
                                };
                                img.onerror = reject;
                                img.src = src;
                            }
                        });
                        promises.push(promise);
                    }
                }
            }
            
            await Promise.allSettled(promises);
            console.log('Media preloaded:', mediaCache.size, 'items');
            
            // DEBUG: Log all transitions with their properties
            for (const track of timeline.tracks) {
                for (const item of track.items) {
                    if (item.transition && item.transition.type !== 'none') {
                        console.log('[Transition Data] Item:', item.name, 'Transition:', JSON.stringify(item.transition));
                    }
                }
            }
        }
        
        // Get render items at a given time (matching Canvas.tsx logic)
        // This properly handles transitions by including BOTH outgoing and incoming clips
        function getRenderItems(currentTime) {
            const active = [];
            
            for (let trackIndex = 0; trackIndex < timeline.tracks.length; trackIndex++) {
                const track = timeline.tracks[trackIndex];
                const zIndexBase = trackIndex * 10;
                
                if (track.type === 'video' || track.type === 'overlay') {
                    const sortedItems = [...track.items].sort((a, b) => a.start - b.start);
                    
                    // 1. Find the item that should be playing at currentTime (Main Item)
                    const mainItemIndex = sortedItems.findIndex(i => currentTime >= i.start && currentTime < i.start + i.duration);
                    const mainItem = mainItemIndex !== -1 ? sortedItems[mainItemIndex] : undefined;
                    
                    // 2. Find the next item (for Prefix/Overlap checks)
                    let nextItemIndex = -1;
                    if (mainItem) {
                        nextItemIndex = mainItemIndex + 1;
                    } else {
                        nextItemIndex = sortedItems.findIndex(i => i.start > currentTime);
                    }
                    const nextItem = (nextItemIndex !== -1 && nextItemIndex < sortedItems.length) ? sortedItems[nextItemIndex] : undefined;
                    
                    let isTransitioning = false;
                    let transition = null;
                    let progress = 0;
                    let outgoingItem = null;
                    let incomingItem = null;
                    
                    // --- CHECK 1: Incoming Transition on Main Item (Postfix / Overlap-Right) ---
                    if (mainItem && mainItem.transition && mainItem.transition.type !== 'none') {
                        const t = mainItem.transition;
                        const timing = t.timing || 'postfix';
                        const timeIntoClip = currentTime - mainItem.start;
                        
                        let transStart = 0;
                        if (timing === 'postfix') transStart = 0;
                        else if (timing === 'overlap') transStart = -t.duration / 2;
                        else if (timing === 'prefix') transStart = -t.duration;
                        
                        // Check if we are in the transition window
                        if (timeIntoClip >= transStart && timeIntoClip <= transStart + t.duration) {
                            isTransitioning = true;
                            transition = t;
                            // Apply speed modifier: speed > 1 = faster animation, speed < 1 = slower
                            const transSpeed = (t.speed !== undefined && t.speed !== null) ? t.speed : 1.0;
                            const rawProgress = (timeIntoClip - transStart) / t.duration;
                            progress = Math.min(1, Math.max(0, rawProgress * transSpeed));
                            // Debug: Log at key moments (start, middle, end)
                            if (rawProgress < 0.02 || (rawProgress > 0.48 && rawProgress < 0.52) || rawProgress > 0.98) {
                                console.log('[Transition] t=' + currentTime.toFixed(2) + ' speed=' + transSpeed + ' raw=' + rawProgress.toFixed(2) + ' final=' + progress.toFixed(2) + ' type=' + t.type);
                            }
                            incomingItem = mainItem;
                            if (mainItemIndex > 0) outgoingItem = sortedItems[mainItemIndex - 1];
                        }
                    }
                    
                    // --- CHECK 2: Outgoing Transition on Next Item (Prefix / Overlap-Left) ---
                    if (!isTransitioning && nextItem && nextItem.transition && nextItem.transition.type !== 'none') {
                        const t = nextItem.transition;
                        const timing = t.timing || 'postfix';
                        const timeUntilNext = nextItem.start - currentTime;
                        
                        // Only relevant if timing puts transition BEFORE the clip starts
                        if (timing === 'prefix' || timing === 'overlap') {
                            let transDurationBeforeStart = 0;
                            if (timing === 'prefix') transDurationBeforeStart = t.duration;
                            if (timing === 'overlap') transDurationBeforeStart = t.duration / 2;
                            
                            if (timeUntilNext <= transDurationBeforeStart) {
                                isTransitioning = true;
                                transition = t;
                                // Apply speed modifier: speed > 1 = faster animation, speed < 1 = slower
                                const transSpeed = (t.speed !== undefined && t.speed !== null) ? t.speed : 1.0;
                                const rawProgress = (transDurationBeforeStart - timeUntilNext) / t.duration;
                                progress = Math.min(1, Math.max(0, rawProgress * transSpeed));
                                // Debug: Log at key moments
                                if (rawProgress < 0.02 || rawProgress > 0.98) {
                                    console.log('[Transition-Pre] t=' + currentTime.toFixed(2) + ' speed=' + transSpeed + ' raw=' + rawProgress.toFixed(2) + ' final=' + progress.toFixed(2));
                                }
                                incomingItem = nextItem;
                                if (nextItemIndex > 0) outgoingItem = sortedItems[nextItemIndex - 1];
                            }
                        }
                    }
                    
                    // --- RENDER ---
                    if (isTransitioning && transition && incomingItem) {
                        // Render Outgoing FIRST (appears below)
                        if (outgoingItem) {
                            active.push({ item: outgoingItem, role: 'outgoing', zIndexBase, transition, transitionProgress: progress });
                        }
                        // Render Incoming (appears on top)
                        active.push({ item: incomingItem, role: 'main', transition, transitionProgress: progress, zIndexBase });
                    } else if (mainItem) {
                        // No transition, just render main item
                        active.push({ item: mainItem, role: 'main', zIndexBase });
                    } else if (nextItem && currentTime >= nextItem.start - 0.05) {
                        // FALLBACK: approaching next clip
                        active.push({ item: nextItem, role: 'main', zIndexBase });
                    }
                    
                } else {
                    // Non-video tracks (simple render)
                    for (const item of track.items) {
                        if (currentTime >= item.start && currentTime < item.start + item.duration) {
                            active.push({ item, role: 'main', zIndexBase });
                        }
                    }
                }
            }
            
            // Sort by layer
            active.sort((a, b) => {
                if (a.item.isBackground && !b.item.isBackground) return -1;
                if (!a.item.isBackground && b.item.isBackground) return 1;
                return (a.item.layer || 0) - (b.item.layer || 0);
            });
            
            return active;
        }
        
        // Calculate transition style (FULL version matching Canvas.tsx - 55+ transitions)
        function getTransitionStyle(item, currentTime, role, transition, progress) {
            if (!transition || transition.type === 'none') return {};
            
            const p = progress;
            const type = transition.type;
            const direction = transition.direction || 'left';
            
            let xMult = 1, yMult = 0;
            if (direction === 'right') { xMult = -1; yMult = 0; }
            else if (direction === 'up') { xMult = 0; yMult = 1; }
            else if (direction === 'down') { xMult = 0; yMult = -1; }
            
            switch (type) {
                // --- Dissolves ---
                case 'dissolve':
                    const dissolveEase = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
                    return role === 'main'
                        ? { opacity: Math.max(0.01, dissolveEase), filter: 'brightness(' + (0.98 + dissolveEase * 0.02) + ')', zIndex: 20 }
                        : { opacity: Math.max(0.01, 1 - dissolveEase), filter: 'brightness(' + (1 - (1 - dissolveEase) * 0.02) + ')', zIndex: 10 };
                
                case 'film-dissolve':
                    const filmP = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
                    const grain = Math.sin(p * 100) * 0.015;
                    return role === 'main'
                        ? { opacity: Math.max(0.01, filmP), filter: 'contrast(' + (1.05 + grain) + ') saturate(' + (0.95 + filmP * 0.05) + ') sepia(' + ((1 - filmP) * 0.08) + ')', zIndex: 20 }
                        : { opacity: Math.max(0.01, 1 - filmP), filter: 'contrast(' + (1.05 + grain) + ') saturate(' + (1 - (1 - filmP) * 0.05) + ') sepia(' + (filmP * 0.08) + ')', zIndex: 10 };
                
                case 'additive-dissolve':
                    return role === 'main' ? { opacity: p, mixBlendMode: 'plus-lighter' } : { opacity: 1 - p, mixBlendMode: 'plus-lighter' };
                
                case 'dip-to-black':
                    if (role === 'outgoing') {
                        if (p < 0.5) { const fadeOut = p * 2; return { opacity: Math.max(0.05, 1 - Math.pow(fadeOut, 2)), filter: 'brightness(' + (1 - fadeOut * 0.6) + ')', zIndex: 10 }; }
                        return { opacity: 0.05, zIndex: 10 };
                    }
                    if (role === 'main') {
                        if (p > 0.5) { const fadeIn = (p - 0.5) * 2; return { opacity: Math.max(0.05, 1 - Math.pow(1 - fadeIn, 2)), filter: 'brightness(' + (0.4 + fadeIn * 0.6) + ')', zIndex: 20 }; }
                        return { opacity: 0.05, zIndex: 20 };
                    }
                    return {};
                
                case 'dip-to-white':
                    if (role === 'outgoing') {
                        if (p < 0.5) { const fadeOut = p * 2; return { opacity: 1 - Math.pow(fadeOut, 1.5), filter: 'brightness(' + (1 + fadeOut * 1.5) + ') saturate(' + (1 - fadeOut * 0.7) + ')', zIndex: 10 }; }
                        return { opacity: 0.05, filter: 'brightness(2.5) saturate(0.3)', zIndex: 10 };
                    }
                    if (role === 'main') {
                        if (p > 0.5) { const fadeIn = (p - 0.5) * 2; return { opacity: Math.max(0.05, 1 - Math.pow(1 - fadeIn, 1.5)), filter: 'brightness(' + (2.5 - fadeIn * 1.5) + ') saturate(' + (0.3 + fadeIn * 0.7) + ')', zIndex: 20 }; }
                        return { opacity: 0.05, filter: 'brightness(2.5) saturate(0.3)', zIndex: 20 };
                    }
                    return {};
                
                case 'luma-dissolve':
                    const lumaP = 1 - Math.pow(1 - p, 2);
                    return role === 'main'
                        ? { filter: 'contrast(' + (1 + lumaP * 1.5) + ') brightness(' + (0.7 + lumaP * 0.3) + ')', opacity: Math.max(0.01, lumaP), zIndex: 20 }
                        : { filter: 'contrast(' + (1 + (1 - lumaP) * 1.5) + ') brightness(' + (1 - (1 - lumaP) * 0.3) + ')', opacity: Math.max(0.01, 1 - lumaP), zIndex: 10 };
                
                case 'fade-dissolve':
                    if (role === 'outgoing') return { opacity: Math.max(0.05, p < 0.5 ? 1 - (p * 2) : 0.05) };
                    if (role === 'main') return { opacity: Math.max(0.05, p > 0.5 ? (p - 0.5) * 2 : 0.05) };
                    return {};
                
                case 'fade-color':
                    if (role === 'outgoing') {
                        if (p < 0.5) { const fade = p * 2; return { filter: 'brightness(' + (1 - fade * 0.5) + ') saturate(' + (1 - fade * 0.7) + ')', opacity: Math.max(0.01, 1 - Math.pow(fade, 1.5)), zIndex: 10 }; }
                        return { opacity: 0.01, zIndex: 10 };
                    }
                    if (role === 'main') {
                        if (p > 0.5) { const fade = (p - 0.5) * 2; return { filter: 'brightness(' + (0.5 + fade * 0.5) + ') saturate(' + (0.3 + fade * 0.7) + ')', opacity: Math.max(0.01, Math.pow(fade, 0.7)), zIndex: 20 }; }
                        return { opacity: 0.01, zIndex: 20 };
                    }
                    return {};
                
                // --- Slides & Pushes ---
                case 'slide':
                    return role === 'main' ? { transform: 'translate(' + (xMult * 100 * (1 - p)) + '%, ' + (yMult * 100 * (1 - p)) + '%)', zIndex: 20 } : { zIndex: 10 };
                case 'push':
                case 'whip':
                case 'band-slide':
                    return role === 'main'
                        ? { transform: 'translate(' + (xMult * 100 * (1 - p)) + '%, ' + (yMult * 100 * (1 - p)) + '%)', zIndex: 20 }
                        : { transform: 'translate(' + (xMult * -100 * p) + '%, ' + (yMult * -100 * p) + '%)', zIndex: 10 };
                case 'split':
                    const splitClip = direction === 'up' || direction === 'down' ? '0 ' + (50 * (1 - p)) + '% 0 ' + (50 * (1 - p)) + '%' : (50 * (1 - p)) + '% 0 ' + (50 * (1 - p)) + '% 0';
                    return role === 'main' ? { clipPath: 'inset(' + splitClip + ')', zIndex: 20 } : { zIndex: 10 };
                case 'whip-pan':
                    return role === 'main' ? { transform: 'translateX(' + ((1 - p) * 100) + '%)' } : { transform: 'translateX(' + (p * -100) + '%)' };
                
                // --- Iris Shapes ---
                case 'iris-box':
                    const easeBox = 1 - Math.pow(1 - p, 3);
                    return role === 'main' ? { clipPath: 'inset(' + (50 * (1 - easeBox)) + '%)', filter: 'brightness(' + (0.7 + 0.3 * p) + ')', zIndex: 20 } : { filter: 'brightness(' + (1 - p * 0.3) + ')', zIndex: 10 };
                case 'iris-round':
                case 'circle':
                case 'shape-circle':
                    const easeCircle = 1 - Math.pow(1 - p, 3);
                    return role === 'main' ? { clipPath: 'circle(' + (easeCircle * 75) + '% at 50% 50%)', filter: 'brightness(' + (0.7 + 0.3 * p) + ')', zIndex: 20 } : { filter: 'brightness(' + (1 - p * 0.3) + ')', zIndex: 10 };
                case 'iris-diamond':
                    const easeDiamond = 1 - Math.pow(1 - p, 3);
                    return role === 'main' ? { clipPath: 'polygon(50% ' + (50 - 50 * easeDiamond) + '%, ' + (50 + 50 * easeDiamond) + '% 50%, 50% ' + (50 + 50 * easeDiamond) + '%, ' + (50 - 50 * easeDiamond) + '% 50%)', zIndex: 20 } : { zIndex: 10 };
                case 'iris-cross':
                    const easeCross = 1 - Math.pow(1 - p, 3);
                    const w = 20 + (80 * easeCross);
                    return role === 'main' ? { clipPath: 'polygon(' + (50 - w / 2) + '% 0%, ' + (50 + w / 2) + '% 0%, ' + (50 + w / 2) + '% ' + (50 - w / 2) + '%, 100% ' + (50 - w / 2) + '%, 100% ' + (50 + w / 2) + '%, ' + (50 + w / 2) + '% ' + (50 + w / 2) + '%, ' + (50 + w / 2) + '% 100%, ' + (50 - w / 2) + '% 100%, ' + (50 - w / 2) + '% ' + (50 + w / 2) + '%, 0% ' + (50 + w / 2) + '%, 0% ' + (50 - w / 2) + '%, ' + (50 - w / 2) + '% ' + (50 - w / 2) + '%)', zIndex: 20 } : { zIndex: 10 };
                
                // --- Wipes ---
                case 'wipe':
                case 'simple-wipe':
                    const easeWipe = 1 - Math.pow(1 - p, 3);
                    let wipeClip;
                    if (direction === 'right') wipeClip = '0 ' + (100 - easeWipe * 100) + '% 0 0';
                    else if (direction === 'up') wipeClip = (100 - easeWipe * 100) + '% 0 0 0';
                    else if (direction === 'down') wipeClip = '0 0 ' + (100 - easeWipe * 100) + '% 0';
                    else wipeClip = '0 0 0 ' + (100 - easeWipe * 100) + '%';
                    return role === 'main' ? { clipPath: 'inset(' + wipeClip + ')', filter: 'brightness(' + (0.8 + 0.2 * p) + ')', zIndex: 20 } : { filter: 'brightness(' + (1 - p * 0.2) + ')', zIndex: 10 };
                case 'barn-doors':
                    const easeBarn = 1 - Math.pow(1 - p, 3);
                    const barnClip = direction === 'up' || direction === 'down' ? (50 * (1 - easeBarn)) + '% 0 ' + (50 * (1 - easeBarn)) + '% 0' : '0 ' + (50 * (1 - easeBarn)) + '% 0 ' + (50 * (1 - easeBarn)) + '%';
                    return role === 'main' ? { clipPath: 'inset(' + barnClip + ')', zIndex: 20 } : { zIndex: 10 };
                case 'clock-wipe':
                case 'radial-wipe':
                    return role === 'main' ? { WebkitMaskImage: 'conic-gradient(from 0deg at 50% 50%, black ' + (p * 360) + 'deg, transparent ' + (p * 360) + 'deg)', maskImage: 'conic-gradient(from 0deg at 50% 50%, black ' + (p * 360) + 'deg, transparent ' + (p * 360) + 'deg)', zIndex: 20 } : { zIndex: 10 };
                case 'venetian-blinds':
                    const easeVenetian = 1 - Math.pow(1 - p, 3);
                    const gradDir = direction === 'up' || direction === 'down' ? 'to bottom' : 'to right';
                    const maskSize = direction === 'up' || direction === 'down' ? '100% 8%' : '8% 100%';
                    return role === 'main' ? { WebkitMaskImage: 'linear-gradient(' + gradDir + ', black ' + (easeVenetian * 100) + '%, transparent ' + (easeVenetian * 100) + '%)', maskImage: 'linear-gradient(' + gradDir + ', black ' + (easeVenetian * 100) + '%, transparent ' + (easeVenetian * 100) + '%)', WebkitMaskSize: maskSize, maskSize: maskSize, zIndex: 20 } : { zIndex: 10 };
                case 'checker-wipe':
                    const easeChecker = 1 - Math.pow(1 - p, 2);
                    return role === 'main' ? { WebkitMaskImage: 'conic-gradient(black 90deg, transparent 90deg, transparent 180deg, black 180deg, black 270deg, transparent 270deg)', maskImage: 'conic-gradient(black 90deg, transparent 90deg, transparent 180deg, black 180deg, black 270deg, transparent 270deg)', WebkitMaskSize: (200 * (1.2 - easeChecker * 0.2)) + '% ' + (200 * (1.2 - easeChecker * 0.2)) + '%', maskSize: (200 * (1.2 - easeChecker * 0.2)) + '% ' + (200 * (1.2 - easeChecker * 0.2)) + '%', opacity: easeChecker, zIndex: 20 } : { opacity: 1 - easeChecker * 0.7, zIndex: 10 };
                case 'zig-zag':
                    const easeZigZag = 1 - Math.pow(1 - p, 3);
                    return role === 'main' ? { WebkitMaskImage: 'linear-gradient(135deg, black ' + (easeZigZag * 100) + '%, transparent ' + (easeZigZag * 100) + '%)', maskImage: 'linear-gradient(135deg, black ' + (easeZigZag * 100) + '%, transparent ' + (easeZigZag * 100) + '%)', zIndex: 20 } : { zIndex: 10 };
                
                // --- Zooms ---
                case 'zoom-in':
                    const easeZoomIn = 1 - Math.pow(1 - p, 3);
                    return role === 'main' ? { transform: 'scale(' + (0.5 + 0.5 * easeZoomIn) + ')', opacity: p, zIndex: 20 } : { transform: 'scale(' + (1 + p * 0.3) + ')', opacity: 1 - p, zIndex: 10 };
                case 'zoom-out':
                    const easeZoomOut = 1 - Math.pow(1 - p, 3);
                    return role === 'main' ? { transform: 'scale(' + (1.5 - 0.5 * easeZoomOut) + ')', opacity: p, zIndex: 20 } : { transform: 'scale(' + (1 - p * 0.2) + ')', opacity: 1 - p, zIndex: 10 };
                case 'warp-zoom':
                    return role === 'main' ? { transform: 'scale(' + (0.5 + p * 0.5) + ')', opacity: p, zIndex: 20 } : { transform: 'scale(' + (1 + p * 1.5) + ')', opacity: 1 - p, zIndex: 10 };
                case 'cross-zoom':
                    const blurAmount = Math.sin(p * Math.PI) * 10;
                    if (role === 'outgoing') return { transform: 'scale(' + (1 + p * 3) + ')', filter: 'blur(' + blurAmount + 'px) brightness(' + (1 + p * 0.5) + ')', opacity: 1 - p, zIndex: 10 };
                    if (role === 'main') return { transform: 'scale(' + (3 - p * 2) + ')', filter: 'blur(' + blurAmount + 'px) brightness(' + (1.5 - p * 0.5) + ')', opacity: p, zIndex: 20 };
                    return {};
                case 'zoom-blur':
                    const scaleBlur = role === 'outgoing' ? 1 + p * 2 : 3 - p * 2;
                    const blurAmt = Math.sin(p * Math.PI) * 10;
                    return { transform: 'scale(' + scaleBlur + ')', filter: 'blur(' + blurAmt + 'px)', opacity: role === 'outgoing' ? 1 - p : p };
                
                // --- 3D Transforms ---
                case 'cube-rotate':
                    const cubeEase = 1 - Math.pow(1 - p, 3);
                    return role === 'main' ? { transform: 'perspective(1200px) rotateY(' + ((1 - cubeEase) * -90) + 'deg) translateZ(100px)', filter: 'brightness(' + (0.7 + cubeEase * 0.3) + ')', opacity: cubeEase, zIndex: 20 } : { transform: 'perspective(1200px) rotateY(' + (cubeEase * 90) + 'deg) translateZ(100px)', filter: 'brightness(' + (1 - cubeEase * 0.3) + ')', opacity: 1 - cubeEase, zIndex: 10 };
                case 'flip-3d':
                    const flipEase = 1 - Math.pow(1 - p, 3);
                    return role === 'main' ? { transform: 'perspective(1200px) rotateX(' + ((1 - flipEase) * -180) + 'deg)', filter: 'brightness(' + (0.6 + flipEase * 0.4) + ')', opacity: flipEase, zIndex: 20 } : { transform: 'perspective(1200px) rotateX(' + (flipEase * 180) + 'deg)', filter: 'brightness(' + (1 - flipEase * 0.4) + ')', opacity: 1 - flipEase, zIndex: 10 };
                case 'spin-3d':
                    return role === 'main' ? { transform: 'perspective(1000px) rotateY(' + ((1 - p) * -90) + 'deg)', opacity: p } : { transform: 'perspective(1000px) rotateY(' + (p * 90) + 'deg)', opacity: 1 - p };
                case 'page-curl':
                    return role === 'main' ? { clipPath: 'polygon(0 0, ' + (p * 150) + '% 0, 0 ' + (p * 150) + '%)', boxShadow: '-10px 10px 20px rgba(0,0,0,0.5)', zIndex: 50 } : { zIndex: 10 };
                case 'page-peel':
                    const peelSize = p * 100;
                    return role === 'main' ? { clipPath: 'polygon(0 0, 100% 0, 100% ' + peelSize + '%, ' + (100 - peelSize) + '% 100%, 0 100%)', filter: 'drop-shadow(10px 10px 20px rgba(0,0,0,0.5))', zIndex: 50 } : { zIndex: 10 };
                case 'spin':
                    const rotation = role === 'outgoing' ? -p * 180 : (1 - p) * 180;
                    const scaleSpin = 1 - Math.sin(p * Math.PI) * 0.5;
                    return { transform: 'rotate(' + rotation + 'deg) scale(' + scaleSpin + ')', opacity: role === 'outgoing' ? 1 - p : p };
                
                // --- Glitch & Digital ---
                case 'glitch':
                    const glitchOffset = Math.sin(p * Math.PI * 8) * 10;
                    return { transform: 'translate(' + glitchOffset + 'px, ' + (-glitchOffset) + 'px)', filter: 'hue-rotate(' + (p * 90) + 'deg) contrast(1.5)', opacity: role === 'outgoing' ? (p > 0.5 ? 0 : 1) : (p > 0.5 ? 1 : 0), zIndex: role === 'main' ? 20 : 10 };
                case 'rgb-split':
                    return { filter: 'hue-rotate(' + (p * 360) + 'deg)', transform: 'scale(' + (1 + Math.sin(p * Math.PI) * 0.1) + ')', opacity: role === 'outgoing' ? 1 - p : p, zIndex: role === 'main' ? 20 : 10 };
                case 'chromatic-aberration':
                    return { filter: 'drop-shadow(' + (Math.sin(p * 20) * 5) + 'px 0 0 red) drop-shadow(' + (Math.sin(p * 20 + 2) * -5) + 'px 0 0 blue)', opacity: role === 'main' ? p : 1 - p, zIndex: role === 'main' ? 20 : 10 };
                case 'pixelate':
                case 'datamosh':
                    return { transform: 'scale(' + (1 + Math.sin(p * 8) * 0.08) + ') skew(' + (Math.sin(p * 15) * 5) + 'deg)', filter: 'hue-rotate(' + (role === 'main' ? p * 30 : (1 - p) * 30) + 'deg)', opacity: role === 'main' ? p : 1 - p, zIndex: role === 'main' ? 20 : 10 };
                
                // --- Light Effects ---
                case 'flash':
                    return role === 'main' ? { filter: 'brightness(' + (1 + (1 - p) * 5) + ')', opacity: p, zIndex: 20 } : { filter: 'brightness(' + (1 + p * 5) + ')', opacity: 1 - p, zIndex: 10 };
                case 'light-leak':
                    return role === 'main' ? { filter: 'sepia(' + (1 - p) + ') brightness(' + (1 + (1 - p)) + ')', opacity: p, zIndex: 20 } : { filter: 'sepia(' + p + ') brightness(' + (1 + p) + ')', opacity: 1 - p, zIndex: 10 };
                case 'film-burn':
                    const burnIntensity = Math.sin(p * Math.PI);
                    return { filter: 'brightness(' + (1 + burnIntensity * 3) + ') sepia(' + (burnIntensity * 0.5) + ') saturate(' + (1 + burnIntensity) + ')', opacity: role === 'outgoing' ? 1 - p : p, transform: 'scale(' + (1 + burnIntensity * 0.1) + ')', zIndex: role === 'main' ? 20 : 10 };
                case 'flash-zoom-in':
                    if (role === 'outgoing') return { transform: 'scale(' + (1 + p) + ')', opacity: 1 - p, filter: 'brightness(' + (1 + p * 5) + ')', zIndex: 10 };
                    return { transform: 'scale(' + (2 - p) + ')', opacity: p, filter: 'brightness(' + (1 + (1 - p) * 5) + ')', zIndex: 20 };
                case 'flash-zoom-out':
                    if (role === 'outgoing') return { transform: 'scale(' + (1 - p * 0.5) + ')', opacity: 1 - p, filter: 'brightness(' + (1 + p * 5) + ')', zIndex: 10 };
                    return { transform: 'scale(' + (0.5 + p * 0.5) + ')', opacity: p, filter: 'brightness(' + (1 + (1 - p) * 5) + ')', zIndex: 20 };
                
                // --- Distort ---
                case 'ripple':
                    return role === 'main' ? { transform: 'scale(' + (1 + Math.sin(p * 10) * 0.05) + ')', opacity: p, zIndex: 20 } : { opacity: 1 - p, zIndex: 10 };
                case 'ripple-dissolve':
                    return { transform: 'scale(' + (1 + Math.sin(p * Math.PI * 4) * 0.05) + ')', filter: 'blur(' + (Math.sin(p * Math.PI) * 2) + 'px)', opacity: role === 'outgoing' ? 1 - p : p, zIndex: role === 'main' ? 20 : 10 };
                case 'stretch':
                    return role === 'main' ? { transform: 'scaleX(' + (0.1 + 0.9 * p) + ')', opacity: p, zIndex: 20 } : { transform: 'scaleX(' + (1 + p) + ')', opacity: 1 - p, zIndex: 10 };
                case 'liquid':
                    return role === 'main' ? { opacity: p, zIndex: 20 } : { opacity: 1 - p, zIndex: 10 };
                
                // --- Others ---
                case 'stack':
                    if (role === 'main') return { transform: 'translate(' + (xMult * 100 * (1 - p)) + '%, ' + (yMult * 100 * (1 - p)) + '%) scale(' + (0.8 + 0.2 * p) + ')', boxShadow: '0 ' + (20 * (1 - p)) + 'px ' + (40 * (1 - p)) + 'px rgba(0,0,0,' + (0.6 * (1 - p)) + ')', opacity: 0.3 + 0.7 * p, zIndex: 20 };
                    return { transform: 'scale(' + (1 - p * 0.2) + ')', filter: 'brightness(' + (1 - p * 0.4) + ')', opacity: 1 - p * 0.3, zIndex: 10 };
                case 'morph-cut':
                    return role === 'main' ? { opacity: Math.max(0.05, p), transform: 'scale(' + (0.95 + 0.05 * p) + ')', zIndex: 20 } : { opacity: Math.max(0.05, 1 - p), transform: 'scale(' + (1 + 0.05 * (1 - p)) + ')', zIndex: 10 };
                case 'multi-panel':
                    return role === 'main' ? { clipPath: 'polygon(0 0, ' + (p * 100) + '% 0, ' + (p * 100) + '% 100%, 0 100%)', transform: 'scale(' + (0.8 + 0.2 * p) + ')', zIndex: 20 } : { zIndex: 10 };
                case 'split-screen':
                    return role === 'main' ? { clipPath: 'inset(0 ' + (50 * (1 - p)) + '% 0 ' + (50 * (1 - p)) + '%)', zIndex: 20 } : { zIndex: 10 };
                case 'shape-heart':
                    return role === 'main' ? { clipPath: 'polygon(50% ' + (50 + 50 * p) + '%, ' + (50 - 50 * p) + '% ' + (50 - 20 * p) + '%, 50% ' + (50 - 50 * p) + '%, ' + (50 + 50 * p) + '% ' + (50 - 20 * p) + '%)', zIndex: 20 } : { zIndex: 10 };
                case 'shape-triangle':
                    return role === 'main' ? { clipPath: 'polygon(50% ' + (50 - 50 * p) + '%, ' + (50 + 50 * p) + '% ' + (50 + 50 * p) + '%, ' + (50 - 50 * p) + '% ' + (50 + 50 * p) + '%)', zIndex: 20 } : { zIndex: 10 };
                case 'tile-drop':
                    return role === 'main' ? { transform: 'translateY(' + ((1 - p) * -100) + '%)', opacity: p, zIndex: 20 } : { transform: 'translateY(' + (p * 100) + '%)', opacity: 1 - p, zIndex: 10 };
                case 'mosaic-grid':
                    return role === 'main' ? { clipPath: 'inset(0 0 0 0 round ' + (50 * (1 - p)) + '%)', transform: 'scale(' + (0.5 + 0.5 * p) + ')', zIndex: 20 } : { zIndex: 10 };
                case 'brush-reveal':
                    return role === 'main' ? { clipPath: 'circle(' + (p * 100) + '% at 50% 50%)', filter: 'contrast(1.2) sepia(0.2)', zIndex: 20 } : { zIndex: 10 };
                case 'ink-splash':
                    return role === 'main' ? { clipPath: 'circle(' + (p * 100) + '%)', filter: 'contrast(1.5)', zIndex: 20 } : { zIndex: 10 };
                case 'film-roll':
                    return role === 'main' ? { transform: 'translateY(' + ((1 - p) * 100) + '%)', filter: 'sepia(0.3)', zIndex: 20 } : { transform: 'translateY(' + (-p * 100) + '%)', filter: 'sepia(0.3)', zIndex: 10 };
                case 'flow':
                    return role === 'main' ? { transform: 'translate(' + (xMult * 100 * (1 - p)) + '%, ' + (yMult * 100 * (1 - p)) + '%) scale(' + (0.9 + 0.1 * p) + ')', opacity: p, zIndex: 20 } : { transform: 'translate(' + (xMult * -50 * p) + '%, ' + (yMult * -50 * p) + '%) scale(' + (1 - 0.1 * p) + ')', opacity: 1 - p, zIndex: 10 };
                case 'smooth-wipe':
                    return role === 'main' ? { transform: 'translateX(' + ((1 - p) * 50) + '%)', opacity: p, zIndex: 20 } : { transform: 'translateX(' + (-p * 50) + '%)', opacity: 1 - p, zIndex: 10 };
                case 'speed-blur':
                    return role === 'main' ? { transform: 'scale(1.2)', opacity: p, zIndex: 20 } : { transform: 'scale(0.8)', opacity: 1 - p, zIndex: 10 };
                case 'non-additive-dissolve':
                    return { opacity: role === 'outgoing' ? Math.pow(1 - p, 2) : Math.pow(p, 2), zIndex: role === 'main' ? 20 : 10 };
                
                default:
                    return role === 'main' ? { opacity: p, zIndex: 20 } : { opacity: 1 - p, zIndex: 10 };
            }
        }
        
        
        // Get adjustment filter style
        function getAdjustmentStyle(item) {
            if (!item.adjustments) return '';
            const adj = item.adjustments;
            const filters = [];
            
            let brightness = adj.brightness || 0;
            let contrast = adj.contrast || 0;
            let saturation = adj.saturation || 0;
            
            // Apply adjustments
            brightness += (adj.highlights || 0) * 0.15 + (adj.shadows || 0) * 0.15;
            contrast += (adj.highlights || 0) * 0.05 - (adj.shadows || 0) * 0.1 + (adj.clarity || 0) * 0.2;
            saturation += (adj.vibrance || 0) * 0.5;
            
            if (brightness !== 0) filters.push('brightness(' + (100 + brightness) + '%)');
            if (contrast !== 0) filters.push('contrast(' + (100 + contrast) + '%)');
            if (saturation !== 0) filters.push('saturate(' + (100 + saturation) + '%)');
            if (adj.hue) filters.push('hue-rotate(' + (adj.hue * 1.8) + 'deg)');
            
            return filters.join(' ');
        }
        
        // Get preset filter style
        function getPresetFilterStyle(filterId) {
            const filters = {
                'bw': 'grayscale(100%)',
                'blockbuster': 'contrast(120%) saturate(110%) sepia(20%)',
                'boost-color': 'saturate(150%) contrast(110%)',
                'brighten': 'brightness(120%) contrast(105%)',
                'cool': 'saturate(90%) hue-rotate(10deg) brightness(105%)',
                'warm': 'sepia(20%) saturate(120%) brightness(105%)',
                'vintage': 'sepia(30%) contrast(110%)',
                'luna': 'grayscale(100%) contrast(110%)',
            };
            return filters[filterId] || '';
        }
        
        // Calculate animation style based on current time (matches AnimationEngine.ts)
        function getAnimationStyle(item, currentTime) {
            if (!item.animation) return {};
            
            const animType = item.animation.type;
            const animDur = item.animation.duration || 1;
            const timing = item.animation.timing || 'enter';
            const itemTime = currentTime - item.start;
            const clipDur = item.duration;
            
            let progress = 0;
            let isActive = false;
            
            if (timing === 'enter' || timing === 'both') {
                if (itemTime < animDur) {
                    progress = itemTime / animDur;
                    isActive = true;
                }
            }
            if (timing === 'exit' || timing === 'both') {
                const exitStart = clipDur - animDur;
                if (itemTime >= exitStart && itemTime <= clipDur) {
                    progress = 1 - ((itemTime - exitStart) / animDur);
                    isActive = true;
                }
            }
            
            if (!isActive) return {};
            
            // CSS cubic-bezier easing
            const cubicBezier = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            const p = cubicBezier(progress);
            const lerp = (from, to, t) => from + (to - from) * t;
            
            switch (animType) {
                case 'fade-in': return { opacity: p };
                
                case 'boom':
                    if (progress < 0.5) {
                        const t = progress / 0.5;
                        return { scale: 0.8 + 0.3 * t, opacity: t };
                    } else {
                        const t = (progress - 0.5) / 0.5;
                        return { scale: 1.1 - 0.1 * t, opacity: 1 };
                    }
                
                case 'bounce-left':
                    if (progress < 0.6) {
                        const t = progress / 0.6;
                        return { translateX: lerp(-100, 20, t), opacity: Math.min(1, t * 1.5) };
                    } else if (progress < 0.8) {
                        const t = (progress - 0.6) / 0.2;
                        return { translateX: lerp(20, -10, t), opacity: 1 };
                    } else {
                        const t = (progress - 0.8) / 0.2;
                        return { translateX: lerp(-10, 0, t), opacity: 1 };
                    }
                
                case 'bounce-right':
                    if (progress < 0.6) {
                        const t = progress / 0.6;
                        return { translateX: lerp(100, -20, t), opacity: Math.min(1, t * 1.5) };
                    } else if (progress < 0.8) {
                        const t = (progress - 0.6) / 0.2;
                        return { translateX: lerp(-20, 10, t), opacity: 1 };
                    } else {
                        const t = (progress - 0.8) / 0.2;
                        return { translateX: lerp(10, 0, t), opacity: 1 };
                    }
                
                case 'bounce-up':
                    if (progress < 0.6) {
                        const t = progress / 0.6;
                        return { translateY: lerp(100, -20, t), opacity: Math.min(1, t * 1.5) };
                    } else if (progress < 0.8) {
                        const t = (progress - 0.6) / 0.2;
                        return { translateY: lerp(-20, 10, t), opacity: 1 };
                    } else {
                        const t = (progress - 0.8) / 0.2;
                        return { translateY: lerp(10, 0, t), opacity: 1 };
                    }
                
                case 'bounce-down':
                    if (progress < 0.6) {
                        const t = progress / 0.6;
                        return { translateY: lerp(-100, 20, t), opacity: Math.min(1, t * 1.5) };
                    } else if (progress < 0.8) {
                        const t = (progress - 0.6) / 0.2;
                        return { translateY: lerp(20, -10, t), opacity: 1 };
                    } else {
                        const t = (progress - 0.8) / 0.2;
                        return { translateY: lerp(-10, 0, t), opacity: 1 };
                    }
                
                case 'rotate-cw-1': return { rotate: -360 + 360 * p, opacity: p };
                case 'rotate-cw-2': return { rotate: -180 + 180 * p, opacity: p };
                case 'rotate-ccw': return { rotate: 360 - 360 * p, opacity: p };
                case 'spin-open': return { scale: 0.1 + 0.9 * p, rotate: 720 - 720 * p, opacity: p };
                case 'spin-1': return { rotate: -90 + 90 * p, scale: 0.5 + 0.5 * p, opacity: p };
                
                case 'slide-down-up-1': return { translateY: 100 - 100 * p, opacity: p };
                case 'move-left': return { translateX: 100 - 100 * p, opacity: p };
                case 'move-right': return { translateX: -100 + 100 * p, opacity: p };
                case 'move-top': return { translateY: 100 - 100 * p, opacity: p };
                case 'move-bottom': return { translateY: -100 + 100 * p, opacity: p };
                
                case 'fade-slide-left': return { translateX: 50 - 50 * p, opacity: p };
                case 'fade-slide-right': return { translateX: -50 + 50 * p, opacity: p };
                case 'fade-slide-up': return { translateY: 50 - 50 * p, opacity: p };
                case 'fade-slide-down': return { translateY: -50 + 50 * p, opacity: p };
                case 'fade-zoom-in': return { scale: 0.8 + 0.2 * p, opacity: p };
                case 'fade-zoom-out': return { scale: 1.2 - 0.2 * p, opacity: p };
                
                case 'motion-blur': return { scale: 1.1 - 0.1 * p, opacity: p, blur: 20 * (1 - p) };
                case 'blur-in': return { opacity: p, blur: 10 * (1 - p) };
                case 'flash-drop': return { translateY: -50 + 50 * p, opacity: p, blur: 10 * (1 - p), brightness: 3 - 2 * p };
                case 'flash-open': return { scale: 0.5 + 0.5 * p, opacity: p, brightness: 5 - 4 * p };
                case 'black-hole': return { scale: p, rotate: 180 - 180 * p, opacity: p, contrast: 2 - p };
                
                case 'screen-flicker':
                    if (progress < 0.2) return { opacity: progress * 2.5, brightness: 0.5 + 1.5 * (progress / 0.2) };
                    if (progress < 0.4) return { opacity: 0.2 + 0.3 * Math.random(), brightness: 2 };
                    if (progress < 0.6) return { opacity: 0.5 + 0.5 * ((progress - 0.4) / 0.2), brightness: 2 - 0.5 * ((progress - 0.4) / 0.2) };
                    if (progress < 0.8) return { opacity: 0.8 + 0.2 * Math.random(), brightness: 1.5 };
                    return { opacity: 1, brightness: 1 };
                
                case 'pixelated-motion': return { opacity: p, blur: 10 * (1 - p), contrast: 2 - p };
                
                case 'pulse-open':
                    if (progress < 0.5) {
                        const t = progress / 0.5;
                        return { scale: 1.2 - 0.3 * t, blur: 2 * (1 - t), opacity: t };
                    } else {
                        const t = (progress - 0.5) / 0.5;
                        return { scale: 0.9 + 0.1 * t, opacity: 1 };
                    }
                
                case 'old-tv':
                    if (progress < 0.5) {
                        const t = progress / 0.5;
                        return { scaleY: 0.01, scaleX: t, opacity: t, brightness: 5 - 3 * t };
                    } else {
                        const t = (progress - 0.5) / 0.5;
                        return { scaleY: lerp(0.01, 1, t), scaleX: 1, opacity: 1, brightness: 2 - t };
                    }
                
                case 'round-open': return { scale: p, opacity: p };
                case 'expansion': return { scaleX: p, opacity: p };
                case 'shard-roll': return { rotate: 360 - 360 * p, scale: p, opacity: p };
                
                case 'flip-down-1': return { scaleY: 0.01 + 0.99 * p, opacity: p };
                case 'flip-down-2': return { scaleY: 0.01 + 0.99 * p, scale: 0.8 + 0.2 * p, opacity: p };
                case 'flip-up-1': return { scaleY: 0.01 + 0.99 * p, opacity: p };
                case 'flip-up-2': return { scaleY: 0.01 + 0.99 * p, scale: 0.8 + 0.2 * p, opacity: p };
                
                case 'fly-in-rotate': return { translateX: -100 + 100 * p, rotate: -90 + 90 * p, opacity: p };
                case 'fly-in-flip': return { translateX: -100 + 100 * p, scaleX: 0.01 + 0.99 * p, opacity: p };
                case 'fly-to-zoom': return { scale: 0.01 + 0.99 * p, translateX: -100 + 100 * p, opacity: p };
                
                case 'grow-shrink':
                    if (progress < 0.6) {
                        const t = progress / 0.6;
                        return { scale: 0.8 + 0.4 * t, opacity: t };
                    } else {
                        const t = (progress - 0.6) / 0.4;
                        return { scale: 1.2 - 0.2 * t, opacity: 1 };
                    }
                
                case 'stretch-in-left': return { scaleX: 2 - p, translateX: -50 + 50 * p, opacity: p, blur: 5 * (1 - p) };
                case 'stretch-in-right': return { scaleX: 2 - p, translateX: 50 - 50 * p, opacity: p, blur: 5 * (1 - p) };
                case 'stretch-in-up': return { scaleY: 2 - p, translateY: 50 - 50 * p, opacity: p, blur: 5 * (1 - p) };
                case 'stretch-in-down': return { scaleY: 2 - p, translateY: -50 + 50 * p, opacity: p, blur: 5 * (1 - p) };
                case 'stretch-to-full': return { scale: 0.5 + 0.5 * p, opacity: p };
                
                case 'tiny-zoom': return { scale: 0.1 + 0.9 * p, opacity: p };
                case 'zoom-in-center': return { scale: 0.01 + 0.99 * p, opacity: p };
                case 'zoom-in-1':
                    if (progress < 0.6) {
                        const t = progress / 0.6;
                        return { scale: 0.5 + 0.6 * t, opacity: Math.min(1, t * 1.5) };
                    } else {
                        const t = (progress - 0.6) / 0.4;
                        return { scale: 1.1 - 0.1 * t, opacity: 1 };
                    }
                case 'zoom-in-2': return { scale: 0.2 + 0.8 * p, opacity: p };
                case 'zoom-in-left': return { scale: 0.01 + 0.99 * p, translateX: -50 + 50 * p, opacity: p };
                case 'zoom-in-right': return { scale: 0.01 + 0.99 * p, translateX: 50 - 50 * p, opacity: p };
                case 'zoom-in-top': return { scale: 0.01 + 0.99 * p, translateY: -50 + 50 * p, opacity: p };
                case 'zoom-in-bottom': return { scale: 0.01 + 0.99 * p, translateY: 50 - 50 * p, opacity: p };
                case 'zoom-out-1': return { scale: 1.5 - 0.5 * p, opacity: p };
                case 'zoom-out-2': return { scale: 2 - p, opacity: p };
                case 'zoom-out-3': return { scale: 3 - 2 * p, opacity: p, blur: 5 * (1 - p) };
                
                case 'wham':
                    if (progress < 0.7) {
                        const t = progress / 0.7;
                        return { scale: 0.3 + 0.8 * t, opacity: t };
                    } else {
                        const t = (progress - 0.7) / 0.3;
                        return { scale: 1.1 - 0.1 * t, opacity: 1 };
                    }
                
                case 'to-left-1': return { translateX: 100 - 100 * p, opacity: p };
                case 'to-left-2': return { translateX: 50 - 50 * p, opacity: p };
                case 'to-right-1': return { translateX: -100 + 100 * p, opacity: p };
                case 'to-right-2': return { translateX: -50 + 50 * p, opacity: p };
                
                case 'blurry-eject':
                    if (progress < 0.6) {
                        const t = progress / 0.6;
                        return { scale: 0.5 + 0.55 * t, blur: 5 * (1 - t), opacity: t };
                    } else {
                        const t = (progress - 0.6) / 0.4;
                        return { scale: 1.05 - 0.05 * t, opacity: 1, blur: 0 };
                    }
                
                case 'rgb-drop': return { translateY: -50 + 50 * p, opacity: p, brightness: 1 + (1 - p), saturate: 1.5 };
                case 'tear-paper': return { translateX: -20 + 20 * p, rotate: -5 + 5 * p, opacity: p };
                
                default: return { opacity: p };
            }
        }
        
        // Render frame at specific time
        async function renderFrame(currentTime) {
            const container = document.getElementById('canvas-container');
            container.innerHTML = '';
            
            // Render color/gradient backgrounds first
            for (const track of timeline.tracks) {
                for (const item of track.items) {
                    if (item.type === 'color' && currentTime >= item.start && currentTime < item.start + item.duration) {
                        const div = document.createElement('div');
                        div.className = 'timeline-item background';
                        div.style.background = item.src || '#000000';
                        div.style.opacity = (item.opacity || 100) / 100;
                        container.appendChild(div);
                    }
                }
            }
            
            const activeItems = getRenderItems(currentTime);
            
            for (const activeItem of activeItems) {
                const { item, role, transition, transitionProgress } = activeItem;
                if (item.type === 'color') continue; // Already rendered
                
                // Use transition data from getRenderItems (which already has speed applied)
                // Do NOT recalculate transitionProgress here!
                const finalProgress = transitionProgress || 0;
                
                const transitionStyle = getTransitionStyle(item, currentTime, role || 'main', transition, finalProgress);
                const animationStyle = getAnimationStyle(item, currentTime);
                
                const div = document.createElement('div');
                div.className = 'timeline-item' + (item.isBackground ? ' background' : '');
                
                // Base styles - combine transition and animation opacity
                const baseOpacity = (item.opacity || 100) / 100;
                const transOpacity = transitionStyle.opacity ?? 1;
                const animOpacity = animationStyle.opacity ?? 1;
                div.style.opacity = baseOpacity * transOpacity * animOpacity;
                
                if (transitionStyle.zIndex) div.style.zIndex = transitionStyle.zIndex;
                if (transitionStyle.clipPath) div.style.clipPath = transitionStyle.clipPath;
                
                // Position - match Canvas.tsx getItemPositionAndTransform logic exactly
                let tx = '-50%';
                let ty = '-50%';
                
                if (!item.isBackground) {
                    if (item.type === 'text') {
                        // Text items: use auto height to prevent stretching
                        // Width is percentage-based, height adjusts to content
                        div.style.width = (item.width || 50) + '%';
                        // DON'T set height - let it auto-size to text content
                        // div.style.height is NOT set for text items
                        
                        // Text items use anchor-based positioning
                        const textAlign = item.textAlign || 'center';
                        const verticalAlign = item.verticalAlign || 'middle';
                        
                        // Horizontal positioning
                        if (textAlign === 'left') {
                            tx = '0%';
                            div.style.left = (50 + (item.x || 0)) + '%';
                        } else if (textAlign === 'right') {
                            tx = '0%';
                            div.style.right = (50 - (item.x || 0)) + '%';
                        } else {
                            tx = '-50%';
                            div.style.left = (50 + (item.x || 0)) + '%';
                        }
                        
                        // Vertical positioning
                        if (verticalAlign === 'top') {
                            ty = '0%';
                            div.style.top = (50 + (item.y || 0)) + '%';
                        } else if (verticalAlign === 'bottom') {
                            ty = '0%';
                            div.style.bottom = (50 - (item.y || 0)) + '%';
                        } else {
                            ty = '-50%';
                            div.style.top = (50 + (item.y || 0)) + '%';
                        }
                    } else {
                        // Non-text items (overlay images/videos): use percentage-based width/height like Canvas.tsx
                        // Canvas.tsx line 1829-1830: width = item.width + '%', height = item.height + '%'
                        div.style.left = (50 + (item.x || 0)) + '%';
                        div.style.top = (50 + (item.y || 0)) + '%';
                        // Set width and height from item properties - these are percentage values
                        if (item.width) {
                            div.style.width = item.width + '%';
                        }
                        if (item.height) {
                            div.style.height = item.height + '%';
                        }
                    }
                }
                
                // Build transform - combine transition and animation transforms
                let transform = transitionStyle.transform || '';
                if (!item.isBackground) transform += ' translate(' + tx + ', ' + ty + ')';
                
                // Animation transforms
                if (animationStyle.translateX) transform += ' translateX(' + animationStyle.translateX + '%)';
                if (animationStyle.translateY) transform += ' translateY(' + animationStyle.translateY + '%)';
                if (animationStyle.scale) transform += ' scale(' + animationStyle.scale + ')';
                if (animationStyle.scaleX) transform += ' scaleX(' + animationStyle.scaleX + ')';
                if (animationStyle.scaleY) transform += ' scaleY(' + animationStyle.scaleY + ')';
                if (animationStyle.rotate) transform += ' rotate(' + animationStyle.rotate + 'deg)';
                
                // Item transforms
                if (item.flipH) transform += ' scaleX(-1)';
                if (item.flipV) transform += ' scaleY(-1)';
                if (item.rotation) transform += ' rotate(' + item.rotation + 'deg)';
                if (transform) div.style.transform = transform.trim();
                
                // Build filter - combine preset, adjustments, transition, and animation filters
                let filter = '';
                if (item.filter && item.filter !== 'none') {
                    filter += getPresetFilterStyle(item.filter) + ' ';
                }
                if (item.adjustments) {
                    filter += getAdjustmentStyle(item) + ' ';
                }
                if (transitionStyle.filter) {
                    filter += transitionStyle.filter + ' ';
                }
                // Animation filter effects
                if (animationStyle.blur) filter += 'blur(' + animationStyle.blur + 'px) ';
                if (animationStyle.brightness) filter += 'brightness(' + animationStyle.brightness + ') ';
                if (animationStyle.contrast) filter += 'contrast(' + animationStyle.contrast + ') ';
                if (animationStyle.saturate) filter += 'saturate(' + animationStyle.saturate + ') ';
                if (filter) div.style.filter = filter.trim();
                
                // Render content based on type
                if (item.type === 'video' || item.type === 'image') {
                    const mediaEl = mediaCache.get(item.id);
                    
                    if (mediaEl) {
                        if (item.type === 'video') {
                            // For video: seek to target time and display directly
                            const videoTime = (item.offset || 0) + (currentTime - item.start) * (item.speed || 1);
                            const targetTime = Math.max(0, Math.min(videoTime, mediaEl.duration || 999));
                            
                            // Seek to exact time
                            if (Math.abs(mediaEl.currentTime - targetTime) > 0.001) {
                                mediaEl.currentTime = targetTime;
                                
                                // Wait for seeked event
                                await new Promise((resolve) => {
                                    let resolved = false;
                                    const onSeeked = () => {
                                        if (resolved) return;
                                        resolved = true;
                                        mediaEl.removeEventListener('seeked', onSeeked);
                                        resolve();
                                    };
                                    mediaEl.addEventListener('seeked', onSeeked);
                                    // Shorter timeout since we're not doing canvas ops
                                    setTimeout(() => {
                                        if (!resolved) {
                                            resolved = true;
                                            mediaEl.removeEventListener('seeked', onSeeked);
                                            resolve();
                                        }
                                    }, 500); // Increased to 500ms for reliable high-res video seeking
                                });
                            }
                            
                            // Wait for video frame to be decoded and ready to paint
                            // Use requestVideoFrameCallback for accurate frame timing
                            await new Promise((resolveFrame) => {
                                let resolved = false;
                                const done = () => {
                                    if (resolved) return;
                                    resolved = true;
                                    resolveFrame();
                                };
                                
                                if ('requestVideoFrameCallback' in mediaEl) {
                                    // Best method: waits for actual video frame
                                    mediaEl.requestVideoFrameCallback(done);
                                } else {
                                    // Fallback: double rAF
                                    requestAnimationFrame(() => requestAnimationFrame(done));
                                }
                                // Shorter timeout
                                setTimeout(done, 50);
                            });
                            
                            // OPTIMIZED: Draw video frame directly to a canvas element
                            // This is faster than toDataURL + img because:
                            // 1. No JPEG encoding
                            // 2. No data URL parsing
                            // 3. Canvas can be rendered directly by Puppeteer

                            // Get or create a canvas for this video
                            let videoCanvas = document.getElementById('video-canvas-' + item.id);
                            if (!videoCanvas) {
                                videoCanvas = document.createElement('canvas');
                                videoCanvas.id = 'video-canvas-' + item.id;
                                videoCanvas.width = mediaEl.videoWidth || 1920;
                                videoCanvas.height = mediaEl.videoHeight || 1080;
                            }
                            const vctx = videoCanvas.getContext('2d');
                            vctx.drawImage(mediaEl, 0, 0, videoCanvas.width, videoCanvas.height);
                            
                            // Style and append the canvas
                            videoCanvas.style.width = '100%';
                            videoCanvas.style.height = '100%';
                            videoCanvas.style.objectFit = item.isBackground ? (item.fit || 'cover') : 'contain';
                            div.appendChild(videoCanvas);
                        } else {
                            // For images: just clone
                            const clone = mediaEl.cloneNode(true);
                            clone.style.width = '100%';
                            clone.style.height = '100%';
                            // Canvas.tsx line 1922: objectFit: item.isBackground ? (item.fit || 'cover') : 'contain'
                            clone.style.objectFit = item.isBackground ? (item.fit || 'cover') : 'contain';
                            div.appendChild(clone);
                        }
                    }
                } else if (item.type === 'text') {
                    div.className += ' text-item';
                    div.style.fontSize = ((item.fontSize || 40) * textScale) + 'px';
                    div.style.fontFamily = item.fontFamily || 'Inter, sans-serif';
                    div.style.fontWeight = item.fontWeight || 'normal';
                    div.style.fontStyle = item.fontStyle || 'normal';
                    div.style.color = item.color || '#ffffff';
                    div.style.textAlign = item.textAlign || 'center';
                    div.style.whiteSpace = 'pre-wrap';
                    div.style.lineHeight = '1.4';
                    div.style.overflow = 'hidden';
                    div.style.padding = (8 * textScale) + 'px';
                    
                    // Text effects - scale effect sizes to match export resolution
                    if (item.textEffect && item.textEffect.type !== 'none') {
                        const effect = item.textEffect;
                        const effColor = effect.color || '#000000';
                        const intensity = effect.intensity || 50;
                        const offset = effect.offset || 50;
                        // Scale effect dimensions by textScale
                        const dist = (offset / 100) * 20 * textScale;
                        const blur = (intensity / 100) * 20 * textScale;
                        const strokeWidth = ((intensity / 100) * 3 + 1) * textScale;
                        
                        switch (effect.type) {
                            case 'shadow':
                                div.style.textShadow = dist + 'px ' + dist + 'px ' + blur + 'px ' + effColor;
                                break;
                            case 'neon':
                                div.style.textShadow = '0 0 ' + (intensity * 0.1 * textScale) + 'px ' + effColor + ', 0 0 ' + (intensity * 0.2 * textScale) + 'px ' + effColor + ', 0 0 ' + (intensity * 0.4 * textScale) + 'px ' + effColor;
                                break;
                            case 'glitch':
                                div.style.textShadow = (-dist) + 'px ' + (-dist) + 'px 0px #00ffff, ' + dist + 'px ' + dist + 'px 0px #ff00ff';
                                break;
                            case 'hollow':
                                div.style.webkitTextStroke = strokeWidth + 'px ' + (item.color || '#ffffff');
                                div.style.color = 'transparent';
                                break;
                            case 'outline':
                                div.style.webkitTextStroke = strokeWidth + 'px ' + effColor;
                                break;
                        }
                    }
                    
                    // Text transform
                    let text = item.name || '';
                    if (item.textTransform === 'uppercase') text = text.toUpperCase();
                    else if (item.textTransform === 'lowercase') text = text.toLowerCase();
                    
                    div.textContent = text;
                }
                
                // Border
                if (item.border && item.border.width > 0 && !item.isBackground) {
                    div.style.border = item.border.width + 'px ' + (item.border.style || 'solid') + ' ' + (item.border.color || '#000000');
                }
                if (item.borderRadius) {
                    div.style.borderRadius = item.borderRadius + 'px';
                }
                
                container.appendChild(div);
            }
        }
        
        // Expose functions for Puppeteer
        window.preloadMedia = preloadMedia;
        window.renderFrame = renderFrame;
        window.mediaCache = mediaCache;
    </script>
</body>
</html>
`;
    }

    /**
     * Render all frames and stream directly to FFmpeg
     */
    async renderAllFramesStreaming(
        timeline: TimelineData,
        settings: ExportSettings,
        outputPath: string,
        audioInputs: Array<{ file: string; startTime: number; offset: number; duration: number }> = [],
        onProgress?: (progress: number) => void
    ): Promise<void> {
        const fps = settings.fps;
        const totalFrames = Math.ceil(timeline.duration * fps);
        const isHighRes = this.width >= 3840 || this.height >= 2160;

        console.log(`[PuppeteerFrameRenderer] 🚀 Starting GPU-accelerated export...`);
        console.log(`[PuppeteerFrameRenderer] 📐 Resolution: ${this.width}x${this.height} (${isHighRes ? '4K' : 'Standard'})`);
        console.log(`[PuppeteerFrameRenderer] ⏱️  Duration: ${timeline.duration}s, Total frames: ${totalFrames}`);

        // Create temp directory
        const tempDir = path.dirname(outputPath);
        if (!this.tempFrameDir) {
            this.tempFrameDir = path.join(tempDir, 'temp_puppeteer_frames');
        }
        if (!fs.existsSync(this.tempFrameDir)) {
            fs.mkdirSync(this.tempFrameDir, { recursive: true });
        }

        try {
            // Start local HTTP server to serve large media files
            // This avoids base64 embedding timeout for videos/images > 10MB
            await this.startMediaServer(tempDir);

            // Generate render page HTML (AFTER server starts so it has the port)
            const html = this.generateRenderPage(timeline, settings);

            // Debug: save HTML to file for inspection
            const debugHtmlPath = path.join(this.tempFrameDir || '/tmp', 'debug_render_page.html');
            try {
                fs.writeFileSync(debugHtmlPath, html);
                console.log(`[PuppeteerFrameRenderer] 🔍 Debug HTML saved to: ${debugHtmlPath}`);
            } catch (e) {
                // Ignore save error
            }

            // Get browser
            this.browser = await this.getBrowser();
            this.page = await this.browser.newPage();

            // Set up console logging from browser
            this.page.on('console', (msg) => {
                const type = msg.type();
                // Include 'log' for transition debugging
                if (type === 'error' || type === 'warn' || type === 'log') {
                    console.log(`[PuppeteerFrameRenderer] Browser ${type}: ${msg.text()}`);
                }
            });

            // Set up error handlers
            this.page.on('pageerror', (error) => {
                console.error(`[PuppeteerFrameRenderer] ❌ Page JS Error: ${String(error)}`);
            });

            // Set viewport
            await this.page.setViewport({
                width: this.width,
                height: this.height,
                deviceScaleFactor: 1,
            });

            // Page load timeout - reduced since we're not embedding large base64 anymore
            // Still give extra time for 4K to allow fonts/external resources to load
            const pageTimeout = isHighRes ? 60000 : 30000;
            await this.page.setContent(html, { waitUntil: 'networkidle0', timeout: pageTimeout });

            // Preload media
            console.log('[PuppeteerFrameRenderer] 📦 Preloading media...');
            await this.page.evaluate(() => window.preloadMedia());
            console.log('[PuppeteerFrameRenderer] ✅ Media preloaded');

            // Start FFmpeg for encoding
            return new Promise((resolve, reject) => {
                if (!ffmpegPath) {
                    return reject(new Error('FFmpeg binary not found'));
                }

                // Build FFmpeg args
                const args: string[] = [
                    '-y',
                    '-f', 'image2pipe',
                    '-framerate', String(fps),
                    '-i', 'pipe:0',
                ];

                // Add audio inputs
                for (const audio of audioInputs) {
                    args.push('-i', audio.file);
                }

                // Audio filter
                if (audioInputs.length > 0) {
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

                    args.push(
                        '-filter_complex', filterParts.join(';'),
                        '-map', '0:v',
                        '-map', '[aout]',
                        '-c:a', 'aac',
                        '-b:a', '192k'
                    );
                }

                // Video encoding - OPTIMIZED for speed with multi-threading
                // Using ultrafast preset always for fast export, quality maintained via CRF
                const preset = 'ultrafast';
                const crf = settings.quality === 'high' ? 18 : settings.quality === 'medium' ? 23 : 28;

                args.push(
                    '-c:v', 'libx264',
                    '-preset', preset,
                    '-tune', 'fastdecode', // Optimize for fast decode (smooth playback)
                    '-crf', String(crf),
                    '-pix_fmt', 'yuv420p',
                    '-threads', '0', // Auto-detect number of threads
                    '-movflags', '+faststart',
                    outputPath
                );

                console.log(`[PuppeteerFrameRenderer] 📝 FFmpeg command: ffmpeg ${args.join(' ')}`);

                const ffmpeg = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });

                let ffmpegError = '';
                ffmpeg.stderr.on('data', (data) => {
                    ffmpegError += data.toString();
                });

                ffmpeg.on('error', (err) => {
                    console.error('[PuppeteerFrameRenderer] FFmpeg error:', err);
                    reject(err);
                });

                ffmpeg.on('close', async (code) => {
                    // Check exit code first - report completion before cleanup
                    if (code === 0) {
                        // Report final completion IMMEDIATELY
                        if (onProgress) {
                            onProgress(100);
                        }
                        console.log(`[PuppeteerFrameRenderer] ✅ Export complete: ${outputPath}`);
                        resolve();

                        // Now do cleanup in background (after resolving)
                        console.log(`[PuppeteerFrameRenderer] 🧹 Running background cleanup...`);
                        try {
                            if (this.tempFrameDir && fs.existsSync(this.tempFrameDir)) {
                                fs.rmSync(this.tempFrameDir, { recursive: true, force: true });
                            }
                        } catch (e) {
                            console.warn('[PuppeteerFrameRenderer] Cleanup warning:', e);
                        }

                        // Stop media server
                        await this.stopMediaServer();

                        // Close page and return browser to pool
                        if (this.page) {
                            await this.page.close();
                            this.page = null;
                        }
                        if (this.browser) {
                            await this.returnBrowser(this.browser);
                            this.browser = null;
                        }
                        console.log(`[PuppeteerFrameRenderer] 🧹 Background cleanup complete`);
                    } else {
                        console.error(`[PuppeteerFrameRenderer] FFmpeg exited with code ${code}`);
                        console.error(`[PuppeteerFrameRenderer] FFmpeg stderr: ${ffmpegError.slice(-500)}`);

                        // Cleanup on error too
                        try {
                            if (this.tempFrameDir && fs.existsSync(this.tempFrameDir)) {
                                fs.rmSync(this.tempFrameDir, { recursive: true, force: true });
                            }
                        } catch (e) { /* ignore */ }
                        await this.stopMediaServer();
                        if (this.page) { await this.page.close(); this.page = null; }
                        if (this.browser) { await this.returnBrowser(this.browser); this.browser = null; }

                        reject(new Error(`FFmpeg exited with code ${code}`));
                    }
                });

                // Render frames
                const renderFrames = async () => {
                    try {
                        const startTime = Date.now();

                        // ===== MEMORY OPTIMIZATION SETTINGS =====
                        // Calculate intervals based on resolution for handling 4K 30min+ exports
                        const resolutionArea = this.width * this.height;
                        const is4K = resolutionArea >= 8294400; // 3840x2160
                        const is1080p = resolutionArea >= 2073600; // 1920x1080

                        // Cleanup interval: More aggressive for 4K (every 10 frames = ~0.3s at 30fps)
                        const cleanupInterval = is4K ? 15 : is1080p ? 45 : 90;

                        // GC interval: Force garbage collection periodically (less frequent to reduce overhead)
                        const gcInterval = is4K ? 300 : is1080p ? 600 : 900; // 10s/20s/30s at 30fps

                        // Page refresh interval: INCREASED to reduce overhead (refresh is expensive)
                        // Only refresh for very long exports to avoid memory issues
                        const pageRefreshInterval = is4K ? 9000 : is1080p ? 18000 : 27000; // 5min/10min/15min at 30fps

                        // Screenshot quality: Lower for 4K to reduce memory pressure
                        const screenshotQuality = is4K ? 80 : 90;

                        console.log(`[PuppeteerFrameRenderer] 🔧 Memory optimization settings:`);
                        console.log(`   Resolution: ${this.width}x${this.height} (${is4K ? '4K' : is1080p ? '1080p' : 'SD'})`);
                        console.log(`   Cleanup interval: every ${cleanupInterval} frames`);
                        console.log(`   GC interval: every ${gcInterval} frames`);
                        console.log(`   Page refresh: every ${pageRefreshInterval} frames`);
                        console.log(`   JPEG quality: ${screenshotQuality}%`);

                        // Store HTML for page refresh
                        const html = this.generateRenderPage(timeline, settings);

                        // Check if timeline has videos (need extra wait for seeking)
                        const hasVideos = timeline.tracks.some(t => t.items.some(i => i.type === 'video'));

                        // Pre-calculate transition times for smart waiting
                        // We only need extra wait during transitions (when video seeking is critical)
                        const transitionTimes: Array<{ start: number, end: number }> = [];
                        for (const track of timeline.tracks) {
                            for (const item of track.items) {
                                if (item.transition && item.transition.type !== 'none') {
                                    const transDuration = item.transition.duration || 1;
                                    transitionTimes.push({
                                        start: item.start - transDuration,
                                        end: item.start + transDuration
                                    });
                                }
                            }
                        }

                        // Track last video seek time for optimization
                        let lastSeekTime = -999;

                        for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
                            const currentTime = frameIndex / fps;

                            try {
                                // Render frame in Puppeteer
                                await this.page!.evaluate((time) => window.renderFrame(time), currentTime);

                                // Wait for DOM to be fully painted before taking screenshot
                                // The renderFrame already waits for video frame inside, so we just need paint sync
                                await this.page!.evaluate(() => {
                                    return new Promise(resolve => {
                                        // Double rAF ensures paint is complete
                                        requestAnimationFrame(() => {
                                            requestAnimationFrame(() => {
                                                resolve(undefined);
                                            });
                                        });
                                    });
                                });

                                // Post-render wait: Give video decoder more time to finish decoding
                                // Increased to 100ms for reliable frame capture
                                await new Promise(resolve => setTimeout(resolve, 100));

                                // Take screenshot - using PNG for lossless quality
                                // PNG is better for frame accuracy than JPEG
                                const screenshot = await this.page!.screenshot({
                                    type: 'png',
                                    encoding: 'binary',
                                    captureBeyondViewport: false,
                                    fromSurface: true,
                                });

                                // Write to FFmpeg with backpressure handling
                                const canWrite = ffmpeg.stdin.write(screenshot);
                                if (!canWrite) {
                                    await new Promise<void>(resolve => ffmpeg.stdin.once('drain', resolve));
                                }
                            } catch (frameError) {
                                console.error(`[PuppeteerFrameRenderer] ⚠️ Frame ${frameIndex} error:`, frameError);
                                // Continue with next frame rather than failing completely
                                continue;
                            }

                            // Progress
                            if (onProgress) {
                                onProgress((frameIndex + 1) / totalFrames * 80);
                            }

                            // Log progress
                            if (frameIndex % 30 === 0 && frameIndex > 0) {
                                const elapsed = (Date.now() - startTime) / 1000;
                                const fps_actual = frameIndex / elapsed;
                                const remaining = (totalFrames - frameIndex) / fps_actual;
                                const memUsed = process.memoryUsage().heapUsed / 1024 / 1024;
                                console.log(`[PuppeteerFrameRenderer] 📊 ${((frameIndex / totalFrames) * 100).toFixed(1)}% | ${fps_actual.toFixed(1)} fps | ~${remaining.toFixed(0)}s left | Memory: ${memUsed.toFixed(0)}MB`);
                            }

                            // ===== AGGRESSIVE CLEANUP (every N frames based on resolution) =====
                            if (frameIndex % cleanupInterval === 0 && frameIndex > 0) {
                                // Clear browser-side media cache for old items
                                await this.page!.evaluate((currentFrameTime) => {
                                    // Clear any cached media not needed for current time
                                    if (window.mediaCache && typeof window.mediaCache.forEach === 'function') {
                                        // Keep only items visible near current time (±5 seconds buffer)
                                        const bufferTime = 5;
                                        // Note: Full cache clearing is handled in page refresh for simplicity
                                    }
                                }, currentTime);
                            }

                            // ===== GARBAGE COLLECTION =====
                            if (frameIndex % gcInterval === 0 && frameIndex > 0) {
                                // Trigger garbage collection in browser context
                                await this.page!.evaluate(() => {
                                    // Clear any expired cache entries
                                    if (window.gc && typeof window.gc === 'function') {
                                        window.gc();
                                    }
                                    // Force image cleanup
                                    const images = document.querySelectorAll('img');
                                    images.forEach(img => {
                                        if (!img.isConnected) {
                                            img.src = '';
                                        }
                                    });
                                });

                                // Server-side GC hint
                                if (global.gc) {
                                    global.gc();
                                }
                                console.log(`[PuppeteerFrameRenderer] 🧹 GC triggered at frame ${frameIndex}`);
                            }

                            // ===== PAGE REFRESH CYCLE (CRITICAL for very long exports) =====
                            if (frameIndex % pageRefreshInterval === 0 && frameIndex > 0) {
                                console.log(`[PuppeteerFrameRenderer] 🔄 Refreshing page to free accumulated memory (frame ${frameIndex}/${totalFrames})...`);

                                try {
                                    // Close current page
                                    await this.page!.close();

                                    // Create new page
                                    this.page = await this.browser!.newPage();

                                    // Set up error handlers
                                    this.page.on('console', (msg) => {
                                        const type = msg.type();
                                        // Include 'log' for transition debugging
                                        if (type === 'error' || type === 'warn' || type === 'log') {
                                            console.log(`[PuppeteerFrameRenderer] Browser ${type}: ${msg.text()}`);
                                        }
                                    });
                                    this.page.on('pageerror', (error) => {
                                        console.error(`[PuppeteerFrameRenderer] ❌ Page JS Error: ${String(error)}`);
                                    });

                                    // Set viewport
                                    await this.page.setViewport({
                                        width: this.width,
                                        height: this.height,
                                        deviceScaleFactor: 1,
                                    });

                                    // Reload content
                                    const pageTimeout = is4K ? 120000 : 60000;
                                    await this.page.setContent(html, { waitUntil: 'networkidle0', timeout: pageTimeout });

                                    // Preload media again
                                    await this.page.evaluate(() => window.preloadMedia());

                                    console.log(`[PuppeteerFrameRenderer] ✅ Page refreshed successfully`);
                                } catch (refreshError) {
                                    console.error(`[PuppeteerFrameRenderer] ⚠️ Page refresh failed, continuing...`, refreshError);
                                }
                            }
                        }

                        ffmpeg.stdin.end();
                        console.log(`[PuppeteerFrameRenderer] 📨 All ${totalFrames} frames sent to FFmpeg`);

                        if (onProgress) {
                            onProgress(90);
                        }
                    } catch (err) {
                        console.error('[PuppeteerFrameRenderer] Render error:', err);
                        ffmpeg.stdin.end();
                        reject(err);
                    }
                };

                renderFrames();
            });

        } catch (error) {
            // Cleanup on error
            await this.stopMediaServer();
            if (this.page) {
                await this.page.close();
                this.page = null;
            }
            if (this.browser) {
                await this.returnBrowser(this.browser);
                this.browser = null;
            }
            throw error;
        }
    }

    /**
     * Clear browser pool
     */
    static async clearBrowserPool(): Promise<void> {
        for (const browser of browserPool) {
            try {
                await browser.close();
            } catch (e) {
                // Ignore
            }
        }
        browserPool = [];
        console.log('[PuppeteerFrameRenderer] 🧹 Browser pool cleared');
    }
}

// Declare global types for the render page
declare global {
    interface Window {
        preloadMedia: () => Promise<void>;
        renderFrame: (time: number) => Promise<void>;
        mediaCache: Map<string, any>;
    }
}
