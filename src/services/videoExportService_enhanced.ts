// Enhanced filter building functions for server-side export
// This adds support for transitions, animations, text effects, and more

import type { TimelineItemData, ExportSettings } from '../types/videoExport';

/**
 * Build enhanced filter complex with full feature support
 */
export function buildEnhancedFilterComplex(
    items: TimelineItemData[],
    settings: ExportSettings,
    duration: number
): string {
    const { width, height } = settings.resolution;
    const filters: string[] = [];

    // Step 1: Process each input - apply transformations, filters, animations
    const processedStreams: string[] = [];

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const streamLabel = `processed${i}`;

        // Build filter chain for this item
        const itemFilters = buildItemFilterChain(item, i, settings, duration);
        if (itemFilters) {
            filters.push(`${itemFilters}[${streamLabel}]`);
            processedStreams.push(streamLabel);
        }
    }

    // Step 2: Layer items with transitions
    let currentLayer = null;
    for (let i = 0; i < processedStreams.length; i++) {
        const stream = processedStreams[i];
        const item = items[i];
        const nextLabel = i === processedStreams.length - 1 ? 'final' : `layer${i}`;

        if (currentLayer === null) {
            // First item becomes the base
            currentLayer = stream;
        } else {
            // Apply transition if specified
            if (item.transition && item.transition.type !== 'none') {
                const transitionFilter = buildTransitionFilter(
                    currentLayer,
                    stream,
                    item.transition,
                    item.start,
                    nextLabel
                );
                filters.push(transitionFilter);
            } else {
                // Simple overlay - position item on current layer
                const x = item.x || 0;
                const y = item.y || 0;
                const enable = `'between(t,${item.start},${item.start + item.duration})'`;
                filters.push(
                    `[${currentLayer}][${stream}]overlay=x=${x}:y=${y}:enable=${enable}[${nextLabel}]`
                );
            }
            currentLayer = nextLabel;
        }
    }

    // Step 3: Add text overlays
    const textItems = items.filter(item => item.type === 'text');
    for (const textItem of textItems) {
        const textFilter = buildTextFilter(textItem, width, height);
        if (textFilter && currentLayer) {
            const nextLabel = 'text_' + textItem.id;
            filters.push(`[${currentLayer}]${textFilter}[${nextLabel}]`);
            currentLayer = nextLabel;
        }
    }

    // Final output
    if (currentLayer && currentLayer !== 'final') {
        filters.push(`[${currentLayer}]copy[final]`);
    }

    return filters.join(';');
}

/**
 * Build filter chain for a single item (scaling, positioning, filters, animations)
 */
function buildItemFilterChain(
    item: TimelineItemData,
    inputIndex: number,
    settings: ExportSettings,
    totalDuration: number
): string {
    const { width, height } = settings.resolution;
    const filters: string[] = [];

    let chain = `[${inputIndex}:v]`;

    // 1. Trim to item duration
    chain += `trim=start=${item.offset}:duration=${item.duration},setpts=PTS-STARTPTS`;

    // 2. Apply fit mode and scaling
    const scaleFilter = buildScaleFilter(item, width, height);
    if (scaleFilter) {
        chain += `,${scaleFilter}`;
    }

    // 3. Apply color adjustments (brightness, contrast, saturation)
    const colorFilter = buildColorFilter(item);
    if (colorFilter) {
        chain += `,${colorFilter}`;
    }

    // 4. Apply blur filter
    if (item.blur && item.blur > 0) {
        const blurAmount = item.blur / 10; // Normalize
        chain += `,boxblur=${blurAmount}:${blurAmount}`;
    }

    // 5. Apply rotation
    if (item.rotation) {
        const rad = (item.rotation * Math.PI) / 180;
        chain += `,rotate=${rad}:c=none`;
    }

    // 6. Apply flip transformations
    if (item.flipH) {
        chain += `,hflip`;
    }
    if (item.flipV) {
        chain += `,vflip`;
    }

    // 7. Apply animations
    const animationFilter = buildAnimationFilter(item, width, height);
    if (animationFilter) {
        chain += `,${animationFilter}`;
    }

    // 8. Apply opacity
    if (item.opacity !== undefined && item.opacity < 100) {
        chain += `,format=rgba,colorchannelmixer=aa=${item.opacity / 100}`;
    }

    // 9. Loop or pad to match timeline duration if needed
    if (item.duration < totalDuration) {
        chain += `,tpad=stop_mode=clone:stop_duration=${totalDuration - item.duration}`;
    }

    return chain;
}

/**
 * Build scale filter based on fit mode
 */
function buildScaleFilter(item: TimelineItemData, canvasWidth: number, canvasHeight: number): string {
    if (item.isBackground) {
        switch (item.fit) {
            case 'contain':
                return `scale=${canvasWidth}:${canvasHeight}:force_original_aspect_ratio=decrease,pad=${canvasWidth}:${canvasHeight}:(ow-iw)/2:(oh-ih)/2:black`;
            case 'cover':
                return `scale=${canvasWidth}:${canvasHeight}:force_original_aspect_ratio=increase,crop=${canvasWidth}:${canvasHeight}`;
            case 'fill':
            default:
                return `scale=${canvasWidth}:${canvasHeight}`;
        }
    } else {
        const w = item.width || 50;  // percentage
        const h = item.height || 50;
        const targetW = Math.round((w / 100) * canvasWidth);
        const targetH = Math.round((h / 100) * canvasHeight);
        return `scale=${targetW}:${targetH}`;
    }
}

/**
 * Build color adjustment filter
 */
function buildColorFilter(item: TimelineItemData): string {
    const adjustments: string[] = [];

    if (item.brightness !== undefined) {
        const val = (item.brightness - 100) / 100; // -1 to 1
        adjustments.push(`brightness=${val}`);
    }

    if (item.contrast !== undefined) {
        const val = item.contrast / 100; // 0 to 2
        adjustments.push(`contrast=${val}`);
    }

    if (item.saturation !== undefined) {
        const val = item.saturation / 100; // 0 to 3
        adjustments.push(`saturation=${val}`);
    }

    if (adjustments.length > 0) {
        return `eq=${adjustments.join(':')}`;
    }

    return '';
}

/**
 * Build animation filter
 */
function buildAnimationFilter(item: TimelineItemData, width: number, height: number): string {
    if (!item.animation) return '';

    const { type, duration: animDuration, timing } = item.animation;
    const itemDuration = item.duration;

    switch (type) {
        case 'fade-in':
            if (timing === 'enter' || timing === 'both') {
                return `fade=t=in:st=0:d=${animDuration || 1}`;
            }
            break;
        case 'fade-out':
            if (timing === 'exit' || timing === 'both') {
                const startTime = itemDuration - (animDuration || 1);
                return `fade=t=out:st=${startTime}:d=${animDuration || 1}`;
            }
            break;
        case 'zoom-in':
            // Zoom from small to full size
            return `zoompan=z='min(zoom+0.002,1.5)':d=${Math.round(itemDuration * 30)}:s=${width}x${height}`;
        case 'zoom-out':
            // Zoom from full to larger
            return `zoompan=z='1.5-0.002*on':d=${Math.round(itemDuration * 30)}:s=${width}x${height}`;
        case 'slide-in':
            // Slide from left
            return `overlay=x='if(lt(t,${animDuration || 1}),${-width}+(${width}/(${animDuration || 1})*t),0)'`;
        default:
            // Fade in/out is default for unknown animations
            return `fade=t=in:st=0:d=0.5,fade=t=out:st=${itemDuration - 0.5}:d=0.5`;
    }

    return '';
}

/**
 * Build transition filter between two streams
 */
function buildTransitionFilter(
    stream1: string,
    stream2: string,
    transition: { type: string; duration: number },
    startTime: number,
    outputLabel: string
): string {
    const { type, duration: transDuration } = transition;

    // Calculate transition timing
    const offset = startTime;
    const duration = transDuration || 1;

    // Use FFmpeg's xfade filter for common transitions
    switch (type) {
        case 'dissolve':
        case 'fade':
            return `[${stream1}][${stream2}]xfade=transition=fade:duration=${duration}:offset=${offset}[${outputLabel}]`;
        case 'wipe':
            return `[${stream1}][${stream2}]xfade=transition=wiperight:duration=${duration}:offset=${offset}[${outputLabel}]`;
        case 'slide':
            return `[${stream1}][${stream2}]xfade=transition=slideright:duration=${duration}:offset=${offset}[${outputLabel}]`;
        case 'zoom-in':
        case 'zoom':
            return `[${stream1}][${stream2}]xfade=transition=zoomin:duration=${duration}:offset=${offset}[${outputLabel}]`;
        case 'circle':
        case 'iris-round':
            return `[${stream1}][${stream2}]xfade=transition=circleopen:duration=${duration}:offset=${offset}[${outputLabel}]`;
        case 'pixelate':
            return `[${stream1}][${stream2}]xfade=transition=pixelize:duration=${duration}:offset=${offset}[${outputLabel}]`;
        default:
            // Fallback to crossfade (dissolve)
            return `[${stream1}][${stream2}]xfade=transition=fade:duration=${duration}:offset=${offset}[${outputLabel}]`;
    }
}

/**
 * Build text overlay filter using drawtext
 */
function buildTextFilter(item: TimelineItemData, width: number, height: number): string {
    if (item.type !== 'text' || !item.name) return '';

    const text = item.name.replace(/'/g, "\\\\'").replace(/:/g, '\\\\:');
    const fontSize = item.fontSize || 48;
    const color = item.color || 'white';
    const x = item.x || width / 2;
    const y = item.y || height / 2;

    let drawtext = `drawtext=text='${text}':fontsize=${fontSize}:fontcolor=${color}:x=${x}:y=${y}`;

    // Add text effect
    if (item.textEffect) {
        const { type, color: effectColor, intensity, offset } = item.textEffect;

        switch (type) {
            case 'shadow':
                const shadowX = offset || 2;
                const shadowY = offset || 2;
                drawtext += `:shadowx=${shadowX}:shadowy=${shadowY}:shadowcolor=black@0.5`;
                break;
            case 'outline':
                const borderW = intensity || 2;
                drawtext += `:borderw=${borderW}:bordercolor=${effectColor || 'black'}`;
                break;
            case 'background':
                drawtext += `:box=1:boxcolor=${effectColor || 'black@0.5'}:boxborderw=5`;
                break;
        }
    }

    // Apply timing
    drawtext += `:enable='between(t,${item.start},${item.start + item.duration})'`;

    return drawtext;
}
