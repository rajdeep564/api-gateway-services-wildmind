// ============================================
// Image Filters for Server-Side Export
// Pixel manipulation for canvas filters
// ============================================

import type { CanvasRenderingContext2D } from 'canvas';

export interface Adjustments {
    temperature: number;
    tint: number;
    brightness: number;
    contrast: number;
    highlights: number;
    shadows: number;
    whites: number;
    blacks: number;
    saturation: number;
    vibrance: number;
    hue: number;
    sharpness: number;
    clarity: number;
    vignette: number;
}

export const DEFAULT_ADJUSTMENTS: Adjustments = {
    temperature: 0, tint: 0,
    brightness: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
    saturation: 0, vibrance: 0, hue: 0,
    sharpness: 0, clarity: 0, vignette: 0
};

// Filter presets matching client-side FILTERS
export const FILTER_PRESETS: Record<string, { grayscale?: number; sepia?: number; contrast?: number; brightness?: number; saturate?: number; hueRotate?: number; blur?: number }> = {
    'none': {},
    'bw': { grayscale: 100 },
    'blockbuster': { contrast: 120, saturate: 110, sepia: 20, hueRotate: -10 },
    'boost-color': { saturate: 150, contrast: 110 },
    'brighten': { brightness: 120, contrast: 105 },
    'cool': { saturate: 90, hueRotate: 10, brightness: 105 },
    'cool-max': { saturate: 80, hueRotate: 20, brightness: 110, contrast: 110 },
    'darken': { brightness: 80, contrast: 120 },
    'elegant': { sepia: 10, contrast: 110, brightness: 105, saturate: 90 },
    'epic': { contrast: 130, saturate: 120, sepia: 15 },
    'fantasy': { saturate: 130, brightness: 110, hueRotate: -10, contrast: 90 },
    'far-east': { sepia: 20, contrast: 110, brightness: 105, hueRotate: 5 },
    'film-stock': { contrast: 120, saturate: 90, sepia: 10 },
    'jungle': { saturate: 140, hueRotate: -10, brightness: 95 },
    'lomo': { contrast: 130, saturate: 120, sepia: 10 },
    'old-film': { sepia: 50, contrast: 110, grayscale: 20 },
    'polaroid': { contrast: 110, brightness: 110, sepia: 20, saturate: 90 },
    'tv': { contrast: 120, brightness: 110, saturate: 110, blur: 0.5 },
    'vignette-1': { brightness: 90, contrast: 120 },
    'warm': { sepia: 20, saturate: 120, brightness: 105 },
    'warm-max': { sepia: 40, saturate: 140, brightness: 110 },
    'fresco': { sepia: 30, brightness: 110, contrast: 110 },
    'belvedere': { sepia: 40, contrast: 90 },
    'flint': { brightness: 110, contrast: 90, grayscale: 20 },
    'luna': { grayscale: 100, contrast: 110 },
    'festive': { saturate: 150, brightness: 105 },
    'summer': { saturate: 120, sepia: 20, brightness: 110 },
};

/**
 * Apply brightness adjustment to pixel
 * @param value - Current RGB value (0-255)
 * @param brightness - Brightness adjustment (-100 to 100)
 */
function applyBrightness(value: number, brightness: number): number {
    // brightness is percentage relative to 100
    // e.g., 120 means 120% brightness = multiply by 1.2
    const factor = brightness / 100;
    return Math.min(255, Math.max(0, value * factor));
}

/**
 * Apply contrast adjustment to pixel
 * @param value - Current RGB value (0-255)
 * @param contrast - Contrast adjustment (-100 to 100)
 */
function applyContrast(value: number, contrast: number): number {
    const factor = contrast / 100;
    return Math.min(255, Math.max(0, ((value / 255 - 0.5) * factor + 0.5) * 255));
}

/**
 * Apply saturation adjustment to RGB values
 * @param r, g, b - Current RGB values (0-255)
 * @param saturation - Saturation adjustment (0-200, 100 = normal)
 */
function applySaturation(r: number, g: number, b: number, saturation: number): [number, number, number] {
    const factor = saturation / 100;
    const gray = 0.2989 * r + 0.587 * g + 0.114 * b;
    return [
        Math.min(255, Math.max(0, gray + (r - gray) * factor)),
        Math.min(255, Math.max(0, gray + (g - gray) * factor)),
        Math.min(255, Math.max(0, gray + (b - gray) * factor))
    ];
}

/**
 * Apply grayscale filter
 * @param r, g, b - Current RGB values (0-255)
 * @param intensity - Grayscale intensity (0-100)
 */
function applyGrayscale(r: number, g: number, b: number, intensity: number): [number, number, number] {
    const factor = intensity / 100;
    const gray = 0.2989 * r + 0.587 * g + 0.114 * b;
    return [
        r + (gray - r) * factor,
        g + (gray - g) * factor,
        b + (gray - b) * factor
    ];
}

/**
 * Apply sepia filter
 * @param r, g, b - Current RGB values (0-255)
 * @param intensity - Sepia intensity (0-100)
 */
function applySepia(r: number, g: number, b: number, intensity: number): [number, number, number] {
    const factor = intensity / 100;
    // Sepia matrix
    const tr = 0.393 * r + 0.769 * g + 0.189 * b;
    const tg = 0.349 * r + 0.686 * g + 0.168 * b;
    const tb = 0.272 * r + 0.534 * g + 0.131 * b;
    return [
        Math.min(255, r + (tr - r) * factor),
        Math.min(255, g + (tg - g) * factor),
        Math.min(255, b + (tb - b) * factor)
    ];
}

/**
 * Apply hue rotation
 * @param r, g, b - Current RGB values (0-255)
 * @param degrees - Hue rotation in degrees
 */
function applyHueRotate(r: number, g: number, b: number, degrees: number): [number, number, number] {
    const angle = degrees * Math.PI / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    // Rotation matrix for hue
    const matrix = [
        0.213 + 0.787 * cos - 0.213 * sin,
        0.715 - 0.715 * cos - 0.715 * sin,
        0.072 - 0.072 * cos + 0.928 * sin,
        0.213 - 0.213 * cos + 0.143 * sin,
        0.715 + 0.285 * cos + 0.140 * sin,
        0.072 - 0.072 * cos - 0.283 * sin,
        0.213 - 0.213 * cos - 0.787 * sin,
        0.715 - 0.715 * cos + 0.715 * sin,
        0.072 + 0.928 * cos + 0.072 * sin
    ];

    return [
        Math.min(255, Math.max(0, r * matrix[0] + g * matrix[1] + b * matrix[2])),
        Math.min(255, Math.max(0, r * matrix[3] + g * matrix[4] + b * matrix[5])),
        Math.min(255, Math.max(0, r * matrix[6] + g * matrix[7] + b * matrix[8]))
    ];
}

/**
 * Apply all filters to an image on the canvas
 * Processes the entire canvas with the specified filters
 */
export function applyImageFilters(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    filterId: string,
    adjustments?: Adjustments
): void {
    // Get the preset filter settings
    const preset = FILTER_PRESETS[filterId] || {};

    // Normalize adjustments - ensure all values are numbers (undefined -> 0)
    const adj: Adjustments = {
        temperature: adjustments?.temperature ?? 0,
        tint: adjustments?.tint ?? 0,
        brightness: adjustments?.brightness ?? 0,
        contrast: adjustments?.contrast ?? 0,
        highlights: adjustments?.highlights ?? 0,
        shadows: adjustments?.shadows ?? 0,
        whites: adjustments?.whites ?? 0,
        blacks: adjustments?.blacks ?? 0,
        saturation: adjustments?.saturation ?? 0,
        vibrance: adjustments?.vibrance ?? 0,
        hue: adjustments?.hue ?? 0,
        sharpness: adjustments?.sharpness ?? 0,
        clarity: adjustments?.clarity ?? 0,
        vignette: adjustments?.vignette ?? 0
    };

    // Check if any processing is needed
    const hasPreset = Object.keys(preset).length > 0;
    const hasAdjustments = Object.keys(adj).some(key =>
        adj[key as keyof Adjustments] !== 0
    );

    // DEBUG: Always log what we received
    console.log(`[ImageFilters] filterId="${filterId}" hasPreset=${hasPreset} hasAdjustments=${hasAdjustments} brightness=${adj.brightness} contrast=${adj.contrast} saturation=${adj.saturation}`);

    if (!hasPreset && !hasAdjustments) {
        return; // No filters to apply
    }

    // Get image data from the region
    const imageData = ctx.getImageData(x, y, width, height);
    const data = imageData.data;

    // Calculate combined settings
    // Adjustments contribute to the final values
    let effBrightness = adj.brightness;
    let effContrast = adj.contrast;
    let effSaturation = adj.saturation;

    // Apply adjustment modifiers (matching client-side getAdjustmentStyle)
    effBrightness += (adj.highlights * 0.15);
    effContrast += (adj.highlights * 0.05);
    effBrightness += (adj.shadows * 0.15);
    effContrast -= (adj.shadows * 0.1);
    effBrightness += (adj.whites * 0.15);
    effBrightness += (adj.blacks * 0.15);
    effContrast += (adj.clarity * 0.2);
    effSaturation += (adj.vibrance * 0.5);

    // Convert to percentage values (100 = normal)
    const brightness = (preset.brightness || 100) * ((100 + effBrightness) / 100);
    const contrast = (preset.contrast || 100) * ((100 + effContrast) / 100);
    const saturate = (preset.saturate || 100) * ((100 + effSaturation) / 100);
    const grayscale = preset.grayscale || 0;
    const sepia = preset.sepia || 0;
    const hueRotate = (preset.hueRotate || 0) + (adj.hue * 1.8);

    // Process each pixel
    for (let i = 0; i < data.length; i += 4) {
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];
        // Alpha remains unchanged: data[i + 3]

        // Apply grayscale first
        if (grayscale > 0) {
            [r, g, b] = applyGrayscale(r, g, b, grayscale);
        }

        // Apply sepia
        if (sepia > 0) {
            [r, g, b] = applySepia(r, g, b, sepia);
        }

        // Apply hue rotation
        if (hueRotate !== 0) {
            [r, g, b] = applyHueRotate(r, g, b, hueRotate);
        }

        // Apply saturation
        if (saturate !== 100) {
            [r, g, b] = applySaturation(r, g, b, saturate);
        }

        // Apply brightness
        if (brightness !== 100) {
            r = applyBrightness(r, brightness);
            g = applyBrightness(g, brightness);
            b = applyBrightness(b, brightness);
        }

        // Apply contrast
        if (contrast !== 100) {
            r = applyContrast(r, contrast);
            g = applyContrast(g, contrast);
            b = applyContrast(b, contrast);
        }

        // Apply temperature (matches client-side: temp > 0 uses sepia, temp < 0 uses hue-rotate)
        // Client formula: adj.temperature > 0 ? sepia(temperature * 0.3%) : hue-rotate(temperature * -0.3 deg)
        if (adj.temperature !== 0) {
            const temp = adj.temperature;
            if (temp > 0) {
                // Warm: Apply sepia effect at (temperature * 0.3)% intensity
                const sepiaIntensity = temp * 0.3;
                [r, g, b] = applySepia(r, g, b, sepiaIntensity);
            } else {
                // Cool: Apply hue rotation at (temperature * 0.3) degrees
                const hueShift = temp * 0.3; // negative temp * positive factor = negative rotation
                [r, g, b] = applyHueRotate(r, g, b, hueShift);
            }
        }

        // Apply tint (matches client-side: hue-rotate(tint deg))
        // Client formula: hue-rotate(${adj.tint}deg)
        if (adj.tint !== 0) {
            [r, g, b] = applyHueRotate(r, g, b, adj.tint);
        }

        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
    }

    // Put the processed image data back
    ctx.putImageData(imageData, x, y);
}

/**
 * Apply filters to a specific item region after drawing
 * Uses a temporary canvas to process only the item area
 */
export function applyItemFilters(
    mainCtx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    itemX: number,
    itemY: number,
    itemWidth: number,
    itemHeight: number,
    filterId: string,
    adjustments?: Adjustments
): void {
    // Clamp to canvas bounds
    const x = Math.max(0, Math.floor(itemX));
    const y = Math.max(0, Math.floor(itemY));
    const w = Math.min(canvasWidth - x, Math.ceil(itemWidth));
    const h = Math.min(canvasHeight - y, Math.ceil(itemHeight));

    if (w <= 0 || h <= 0) return;

    applyImageFilters(mainCtx, x, y, w, h, filterId, adjustments);
}

/**
 * Apply transition filter effects using pixel manipulation
 * This is needed because node-canvas doesn't support ctx.filter CSS syntax
 * @param ctx - Canvas context
 * @param x, y, width, height - Region to apply filters
 * @param hueRotate - Hue rotation in degrees
 * @param brightness - Brightness multiplier (1 = normal, 2 = 200%)
 * @param contrast - Contrast multiplier (1 = normal)
 * @param sepia - Sepia intensity (0-1)
 * @param saturate - Saturation multiplier (1 = normal)
 */
export function applyTransitionFilters(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    hueRotate: number = 0,
    brightness: number = 1,
    contrast: number = 1,
    sepia: number = 0,
    saturate: number = 1
): void {
    // Check if any processing is needed
    if (hueRotate === 0 && brightness === 1 && contrast === 1 && sepia === 0 && saturate === 1) {
        return;
    }

    // Clamp to canvas bounds
    const canvasWidth = ctx.canvas.width;
    const canvasHeight = ctx.canvas.height;
    const clampedX = Math.max(0, Math.floor(x));
    const clampedY = Math.max(0, Math.floor(y));
    const clampedW = Math.min(canvasWidth - clampedX, Math.ceil(width));
    const clampedH = Math.min(canvasHeight - clampedY, Math.ceil(height));

    if (clampedW <= 0 || clampedH <= 0) return;

    // Get image data from the region
    const imageData = ctx.getImageData(clampedX, clampedY, clampedW, clampedH);
    const data = imageData.data;

    // Convert parameters to percentages for existing functions
    const brightnessPercent = brightness * 100;
    const contrastPercent = contrast * 100;
    const saturatePercent = saturate * 100;
    const sepiaPercent = sepia * 100;

    // Process each pixel
    for (let i = 0; i < data.length; i += 4) {
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];
        // Alpha remains unchanged: data[i + 3]

        // Apply sepia
        if (sepiaPercent > 0) {
            [r, g, b] = applySepia(r, g, b, sepiaPercent);
        }

        // Apply hue rotation
        if (hueRotate !== 0) {
            [r, g, b] = applyHueRotate(r, g, b, hueRotate);
        }

        // Apply saturation
        if (saturatePercent !== 100) {
            [r, g, b] = applySaturation(r, g, b, saturatePercent);
        }

        // Apply brightness
        if (brightnessPercent !== 100) {
            r = applyBrightness(r, brightnessPercent);
            g = applyBrightness(g, brightnessPercent);
            b = applyBrightness(b, brightnessPercent);
        }

        // Apply contrast
        if (contrastPercent !== 100) {
            r = applyContrast(r, contrastPercent);
            g = applyContrast(g, contrastPercent);
            b = applyContrast(b, contrastPercent);
        }

        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
    }

    // Put the processed image data back
    ctx.putImageData(imageData, clampedX, clampedY);
}


