// ============================================
// Transition Engine for Server-Side Video Export
// Ports transition calculations from FFmpegExportService.ts
// ============================================

export interface TransitionStyle {
    // Transform properties
    opacity?: number;
    scale?: number;
    rotate?: number;
    translateX?: number;
    translateY?: number;
    blur?: number;

    // Basic clip (for backward compatibility)
    clipX?: number;
    clipWidth?: number;
    clipY?: number;
    clipHeight?: number;

    // Shape-based clipping (canvas clip path)
    clipShape?: 'none' | 'circle' | 'rect' | 'inset' | 'polygon' | 'arc' | 'blinds' | 'checker';
    clipRadius?: number;           // For circle (0-1 percentage of diagonal)
    clipInsetTop?: number;         // For inset rect (0-1)
    clipInsetRight?: number;
    clipInsetBottom?: number;
    clipInsetLeft?: number;
    clipPoints?: [number, number][]; // For polygon [[x,y]] where x,y are 0-1
    clipArcStart?: number;         // For arc (degrees, 0 = right, -90 = top)
    clipArcEnd?: number;           // For arc (degrees)
    clipStripes?: number;          // For blinds pattern (number of stripes)
    clipCheckerSize?: number;      // For checker pattern (size as fraction)
}

/**
 * Calculate transition effect style based on type, direction, and progress
 * This matches the client-side FFmpegExportService.calculateTransitionStyle exactly
 */
export function calculateTransitionStyle(
    type: string,
    progress: number,
    role: 'main' | 'outgoing',
    direction: string = 'left'
): TransitionStyle {
    const p = progress;
    const outP = 1 - p;

    // Direction multipliers
    let xMult = 1, yMult = 0;
    if (direction === 'right') { xMult = -1; yMult = 0; }
    else if (direction === 'up') { xMult = 0; yMult = 1; }
    else if (direction === 'down') { xMult = 0; yMult = -1; }

    // Easing functions
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    switch (type) {
        // === DISSOLVES ===
        case 'dissolve': {
            const dissolveEase = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
            return role === 'main'
                ? { opacity: dissolveEase }
                : { opacity: 1 - dissolveEase };
        }
        case 'film-dissolve': {
            const filmP = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
            return role === 'main' ? { opacity: filmP } : { opacity: 1 - filmP };
        }
        case 'additive-dissolve':
            return role === 'main' ? { opacity: p } : { opacity: outP };
        case 'dip-to-black':
            if (role === 'outgoing') {
                return p < 0.5 ? { opacity: 1 - p * 2 } : { opacity: 0.05 };
            }
            return p > 0.5 ? { opacity: (p - 0.5) * 2 } : { opacity: 0.05 };
        case 'dip-to-white':
            if (role === 'outgoing') {
                return p < 0.5 ? { opacity: 1 - p * 2 } : { opacity: 0.05 };
            }
            return p > 0.5 ? { opacity: (p - 0.5) * 2 } : { opacity: 0.05 };
        case 'fade-dissolve':
            if (role === 'outgoing') return { opacity: p < 0.5 ? 1 - p * 2 : 0.05 };
            return { opacity: p > 0.5 ? (p - 0.5) * 2 : 0.05 };

        // === SLIDES & PUSHES ===
        case 'slide':
            return role === 'main'
                ? { translateX: xMult * 100 * outP, translateY: yMult * 100 * outP }
                : {};
        case 'push':
            return role === 'main'
                ? { translateX: xMult * 100 * outP, translateY: yMult * 100 * outP }
                : { translateX: xMult * -100 * p, translateY: yMult * -100 * p };
        case 'whip':
            return role === 'main'
                ? { translateX: xMult * 100 * outP, translateY: yMult * 100 * outP, blur: Math.sin(p * Math.PI) * 5 }
                : { translateX: xMult * -100 * p, translateY: yMult * -100 * p, blur: Math.sin(p * Math.PI) * 5 };

        // === IRIS SHAPES ===
        case 'iris-round':
        case 'circle':
        case 'shape-circle': {
            const easeCircle = easeOutCubic(p);
            return role === 'main'
                ? { clipShape: 'circle', clipRadius: easeCircle, opacity: 1 }
                : { opacity: outP };
        }
        case 'iris-box': {
            const easeBox = easeOutCubic(p);
            const inset = 0.5 - 0.5 * easeBox; // 0.5 -> 0 as progress goes 0 -> 1
            return role === 'main'
                ? { clipShape: 'inset', clipInsetTop: inset, clipInsetRight: inset, clipInsetBottom: inset, clipInsetLeft: inset, opacity: 1 }
                : { opacity: outP };
        }
        case 'iris-diamond': {
            const easeDiamond = easeOutCubic(p);
            const d = easeDiamond * 0.5; // 0 -> 0.5
            return role === 'main'
                ? { clipShape: 'polygon', clipPoints: [[0.5, 0.5 - d], [0.5 + d, 0.5], [0.5, 0.5 + d], [0.5 - d, 0.5]], opacity: 1 }
                : { opacity: outP };
        }
        case 'iris-cross': {
            const easeCross = easeOutCubic(p);
            const w = 0.1 + 0.4 * easeCross; // Width of cross arms (0.1 -> 0.5)
            return role === 'main'
                ? {
                    clipShape: 'polygon',
                    clipPoints: [
                        [0.5 - w, 0], [0.5 + w, 0], [0.5 + w, 0.5 - w],
                        [1, 0.5 - w], [1, 0.5 + w], [0.5 + w, 0.5 + w],
                        [0.5 + w, 1], [0.5 - w, 1], [0.5 - w, 0.5 + w],
                        [0, 0.5 + w], [0, 0.5 - w], [0.5 - w, 0.5 - w]
                    ],
                    opacity: 1
                }
                : { opacity: outP };
        }

        // === WIPES ===
        case 'wipe': {
            const easeWipe = easeOutCubic(p);
            if (direction === 'left') {
                return role === 'main' ? { clipShape: 'inset', clipInsetTop: 0, clipInsetRight: 1 - easeWipe, clipInsetBottom: 0, clipInsetLeft: 0 } : {};
            } else if (direction === 'right') {
                return role === 'main' ? { clipShape: 'inset', clipInsetTop: 0, clipInsetRight: 0, clipInsetBottom: 0, clipInsetLeft: 1 - easeWipe } : {};
            } else if (direction === 'up') {
                return role === 'main' ? { clipShape: 'inset', clipInsetTop: 1 - easeWipe, clipInsetRight: 0, clipInsetBottom: 0, clipInsetLeft: 0 } : {};
            } else { // down
                return role === 'main' ? { clipShape: 'inset', clipInsetTop: 0, clipInsetRight: 0, clipInsetBottom: 1 - easeWipe, clipInsetLeft: 0 } : {};
            }
        }
        case 'simple-wipe': {
            const easeWipe = easeOutCubic(p);
            if (direction === 'left') {
                return role === 'main' ? { clipShape: 'inset', clipInsetTop: 0, clipInsetRight: 1 - easeWipe, clipInsetBottom: 0, clipInsetLeft: 0 } : {};
            } else if (direction === 'right') {
                return role === 'main' ? { clipShape: 'inset', clipInsetTop: 0, clipInsetRight: 0, clipInsetBottom: 0, clipInsetLeft: 1 - easeWipe } : {};
            } else if (direction === 'up') {
                return role === 'main' ? { clipShape: 'inset', clipInsetTop: 1 - easeWipe, clipInsetRight: 0, clipInsetBottom: 0, clipInsetLeft: 0 } : {};
            } else { // down
                return role === 'main' ? { clipShape: 'inset', clipInsetTop: 0, clipInsetRight: 0, clipInsetBottom: 1 - easeWipe, clipInsetLeft: 0 } : {};
            }
        }
        case 'barn-doors': {
            const easeBarn = easeOutCubic(p);
            const inset = 0.5 - 0.5 * easeBarn; // Opens from center
            if (direction === 'left' || direction === 'right') {
                return role === 'main' ? { clipShape: 'inset', clipInsetTop: 0, clipInsetRight: inset, clipInsetBottom: 0, clipInsetLeft: inset } : { opacity: outP };
            } else {
                return role === 'main' ? { clipShape: 'inset', clipInsetTop: inset, clipInsetRight: 0, clipInsetBottom: inset, clipInsetLeft: 0 } : { opacity: outP };
            }
        }
        case 'split-screen': {
            const easeSplit = easeOutCubic(p);
            const inset = 0.5 - 0.5 * easeSplit;
            if (direction === 'left' || direction === 'right') {
                return role === 'main' ? { clipShape: 'inset', clipInsetTop: 0, clipInsetRight: inset, clipInsetBottom: 0, clipInsetLeft: inset } : { opacity: outP };
            } else {
                return role === 'main' ? { clipShape: 'inset', clipInsetTop: inset, clipInsetRight: 0, clipInsetBottom: inset, clipInsetLeft: 0 } : { opacity: outP };
            }
        }

        // === ZOOMS ===
        case 'cross-zoom': {
            const blurAmount = Math.sin(p * Math.PI) * 10;
            if (role === 'outgoing') {
                return { scale: 1 + p * 3, blur: blurAmount, opacity: outP };
            }
            return { scale: 3 - p * 2, blur: blurAmount, opacity: p };
        }
        case 'zoom-in':
            return role === 'main' ? { scale: 0.5 + 0.5 * p, opacity: p } : { opacity: outP };
        case 'zoom-out':
            return role === 'outgoing' ? { scale: 1 + p * 0.5, opacity: outP } : { opacity: p };

        // === SPINS ===
        case 'spin':
            return role === 'outgoing'
                ? { rotate: p * 360, scale: outP, opacity: outP }
                : { rotate: (1 - p) * -360, scale: p, opacity: p };

        // === FLASH ===
        case 'flash':
            return role === 'outgoing' ? { opacity: p < 0.5 ? 1 : 0 } : { opacity: p >= 0.5 ? 1 : 0 };

        // === BLUR ===
        case 'blur':
        case 'zoom-blur':
            return role === 'outgoing' ? { blur: p * 20, opacity: outP } : { blur: outP * 20, opacity: p };

        // === GLITCH ===
        case 'glitch': {
            const glitchOffset = Math.sin(p * 50) * 5 * (1 - p);
            return role === 'main' ? { translateX: glitchOffset, opacity: p } : { translateX: -glitchOffset, opacity: outP };
        }

        // === STACK ===
        case 'stack':
            if (role === 'main') {
                return { translateX: xMult * 100 * outP, translateY: yMult * 100 * outP, scale: 0.8 + 0.2 * p, blur: outP * 3, opacity: 0.3 + 0.7 * p };
            }
            return { scale: 1 - p * 0.2, blur: p * 2, opacity: 1 - p * 0.3 };

        // === MORPH ===
        case 'morph-cut':
            return role === 'main' ? { opacity: p, scale: 0.95 + 0.05 * p } : { opacity: outP, scale: 1 + 0.05 * outP };

        // === PAGE ===
        case 'page-peel':
            return role === 'main' ? { rotate: (1 - p) * -5, opacity: p } : { opacity: outP };

        // === FILM & LIGHT EFFECTS ===
        case 'film-burn':
            return { scale: 1 + Math.sin(p * Math.PI) * 0.1, opacity: role === 'main' ? p : outP };
        case 'light-leak':
            return role === 'main' ? { opacity: p } : { opacity: outP };
        case 'luma-dissolve': {
            const lumaP = 1 - Math.pow(1 - p, 2);
            return role === 'main' ? { opacity: lumaP } : { opacity: 1 - lumaP };
        }

        // === DIGITAL EFFECTS ===
        case 'rgb-split':
            return { scale: 1 + Math.sin(p * Math.PI) * 0.1, opacity: role === 'main' ? p : outP };
        case 'pixelate':
        case 'chromatic-aberration':
            return role === 'main' ? { opacity: p } : { opacity: outP };
        case 'datamosh':
            return { scale: 1 + Math.sin(p * 8) * 0.08, opacity: role === 'main' ? p : outP };

        // === DISTORTION ===
        case 'ripple':
            return role === 'main' ? { scale: 1 + Math.sin(p * 10) * 0.05, opacity: p } : { opacity: outP };
        case 'ripple-dissolve':
            return { scale: 1 + Math.sin(p * Math.PI * 4) * 0.05, blur: Math.sin(p * Math.PI) * 2, opacity: role === 'main' ? p : outP };
        case 'stretch':
            return role === 'main' ? { scale: 0.1 + 0.9 * p, opacity: p } : { scale: 1 + p, opacity: outP };
        case 'liquid':
            return { opacity: role === 'main' ? p : outP };

        // === MOVEMENT ===
        case 'flow':
            return role === 'main'
                ? { translateX: xMult * 100 * outP, translateY: yMult * 100 * outP, scale: 0.9 + 0.1 * p, opacity: p }
                : { translateX: xMult * -50 * p, translateY: yMult * -50 * p, scale: 1 - 0.1 * p, opacity: outP };
        case 'smooth-wipe':
            return role === 'main' ? { translateX: 50 * outP, opacity: p } : { translateX: -50 * p, opacity: outP };
        case 'tile-drop':
            return role === 'main' ? { translateY: -100 * outP, opacity: p } : { translateY: 100 * p, opacity: outP };
        case 'whip-pan':
            return role === 'main' ? { translateX: 100 * outP } : { translateX: -100 * p };
        case 'film-roll':
            return role === 'main' ? { translateY: 100 * outP } : { translateY: -100 * p };

        // === ADVANCED DISSOLVES ===
        case 'non-additive-dissolve':
            return { opacity: role === 'main' ? Math.pow(p, 2) : Math.pow(outP, 2) };
        case 'flash-zoom-in':
            return role === 'main' ? { scale: 2 - p, opacity: p } : { scale: 1 + p, opacity: outP };
        case 'flash-zoom-out':
            return role === 'main' ? { scale: 0.5 + p * 0.5, opacity: p } : { scale: 1 - p * 0.5, opacity: outP };

        // === FILMORA-STYLE TRANSITIONS ===

        // Brush reveal - circular reveal with contrast
        case 'brush-reveal':
        case 'ink-splash': {
            const easeP = easeOutCubic(p);
            return role === 'main'
                ? { clipShape: 'circle', clipRadius: easeP, opacity: 1 }
                : { opacity: outP };
        }

        // Simple wipe - basic directional wipe (use inset clipping)
        // Note: Already defined earlier with proper inset clipping

        // Multi-panel - vertical strip reveal
        case 'multi-panel': {
            const easeP = easeOutCubic(p);
            return role === 'main'
                ? { clipShape: 'inset', clipInsetTop: 0, clipInsetRight: 1 - easeP, clipInsetBottom: 0, clipInsetLeft: 0 }
                : { opacity: outP };
        }

        // Split screen - opens from center (already defined earlier)
        // Note: Removed duplicate

        // Shape transitions with proper clipping
        case 'shape-heart': {
            const easeP = easeOutCubic(p);
            const s = easeP * 0.5; // scale factor
            return role === 'main'
                ? {
                    clipShape: 'polygon',
                    clipPoints: [
                        [0.5, 0.5 + s * 0.9],    // bottom point
                        [0.5 - s * 0.9, 0.5 - s * 0.1],
                        [0.5 - s * 0.5, 0.5 - s * 0.6],
                        [0.5, 0.5 - s * 0.3],    // top center dip
                        [0.5 + s * 0.5, 0.5 - s * 0.6],
                        [0.5 + s * 0.9, 0.5 - s * 0.1],
                    ],
                    opacity: 1
                }
                : { opacity: outP };
        }
        case 'shape-triangle': {
            const easeP = easeOutCubic(p);
            const s = easeP * 0.5; // scale factor
            return role === 'main'
                ? { clipShape: 'polygon', clipPoints: [[0.5, 0.5 - s], [0.5 + s, 0.5 + s], [0.5 - s, 0.5 + s]], opacity: 1 }
                : { opacity: outP };
        }

        // 3D Transitions (simplified for canvas)
        case 'cube-rotate':
        case 'flip-3d': {
            const easeP = easeOutCubic(p);
            if (role === 'main') {
                return {
                    rotate: (1 - easeP) * -90 * (direction === 'left' ? 1 : -1),
                    scale: 0.8 + 0.2 * easeP,
                    opacity: easeP
                };
            } else {
                return {
                    rotate: easeP * 90 * (direction === 'left' ? 1 : -1),
                    scale: 1 - 0.2 * easeP,
                    opacity: outP
                };
            }
        }

        case 'spin-3d': {
            return role === 'main'
                ? { rotate: (1 - p) * -90, opacity: p }
                : { rotate: p * 90, opacity: 1 - p };
        }

        case 'page-curl': {
            return role === 'main'
                ? { rotate: (1 - p) * -5, scale: 0.9 + 0.1 * p, opacity: p }
                : { opacity: outP };
        }

        // Digital effects
        case 'mosaic-grid': {
            return role === 'main'
                ? { scale: 0.5 + 0.5 * p, opacity: p }
                : { opacity: outP };
        }

        case 'speed-blur': {
            return role === 'main'
                ? { scale: 1.2, blur: outP * 10, opacity: p }
                : { scale: 0.8, blur: p * 10, opacity: outP };
        }

        // Fade color - fade through color
        case 'fade-color': {
            if (role === 'outgoing') {
                return p < 0.5
                    ? { opacity: 1 - p * 2 }
                    : { opacity: 0.01 };
            }
            return p > 0.5
                ? { opacity: (p - 0.5) * 2 }
                : { opacity: 0.01 };
        }

        // Warp zoom
        case 'warp-zoom': {
            return role === 'main'
                ? { scale: 0.5 + p * 0.5, blur: outP * 5, opacity: p }
                : { scale: 1 + p * 1.5, blur: p * 5, opacity: outP };
        }

        // Band slide
        case 'band-slide': {
            return role === 'main'
                ? { translateX: xMult * 100 * outP, translateY: yMult * 100 * outP }
                : { translateX: xMult * -100 * p, translateY: yMult * -100 * p };
        }

        // Iris variants
        case 'iris-diamond':
        case 'iris-cross': {
            const easeP = easeOutCubic(p);
            return role === 'main'
                ? { scale: easeP, opacity: easeP }
                : { opacity: outP };
        }

        // Random blocks (simplified to fade - too complex for canvas)
        case 'random-blocks':
            return role === 'main' ? { opacity: p } : { opacity: outP };

        // Pattern-based transitions with canvas clipping
        case 'checker-wipe': {
            const easeP = easeOutCubic(p);
            return role === 'main'
                ? { clipShape: 'checker', clipCheckerSize: 0.1, clipRadius: easeP, opacity: 1 }
                : { opacity: outP };
        }
        case 'venetian-blinds': {
            const easeP = easeOutCubic(p);
            return role === 'main'
                ? { clipShape: 'blinds', clipStripes: 12, clipRadius: easeP, opacity: 1 }
                : { opacity: outP };
        }
        case 'zig-zag': {
            const easeP = easeOutCubic(p);
            return role === 'main'
                ? { clipShape: 'blinds', clipStripes: 8, clipRadius: easeP, opacity: 1 }
                : { opacity: outP };
        }
        case 'band-wipe': {
            const easeP = easeOutCubic(p);
            return role === 'main'
                ? { clipShape: 'blinds', clipStripes: 5, clipRadius: easeP, opacity: 1 }
                : { opacity: outP };
        }

        // Radial/Arc transitions
        case 'wedge-wipe': {
            const easeP = easeOutCubic(p);
            const angle = easeP * 180;
            return role === 'main'
                ? { clipShape: 'arc', clipArcStart: -angle, clipArcEnd: angle, opacity: 1 }
                : { opacity: outP };
        }
        case 'clock-wipe':
        case 'radial-wipe': {
            const easeP = easeOutCubic(p);
            return role === 'main'
                ? { clipShape: 'arc', clipArcStart: -90, clipArcEnd: -90 + 360 * easeP, opacity: 1 }
                : { opacity: outP };
        }

        // DEFAULT
        default:
            return { opacity: role === 'main' ? p : outP };
    }
}
