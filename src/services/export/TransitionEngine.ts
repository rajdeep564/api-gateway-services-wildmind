// ============================================
// Transition Engine for Server-Side Video Export
// Ports transition calculations from FFmpegExportService.ts
// ============================================

export interface TransitionStyle {
    opacity?: number;
    scale?: number;
    rotate?: number;
    translateX?: number;
    translateY?: number;
    blur?: number;
    clipX?: number;
    clipWidth?: number;
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
        case 'iris-box':
        case 'iris-round':
        case 'circle': {
            const easeCircle = easeOutCubic(p);
            return role === 'main'
                ? { scale: easeCircle, opacity: easeCircle }
                : { opacity: outP };
        }

        // === WIPES ===
        case 'wipe': {
            const easeWipe = easeOutCubic(p);
            return role === 'main'
                ? { clipX: direction === 'right' ? 0 : direction === 'left' ? 1 - easeWipe : 0, clipWidth: easeWipe }
                : {};
        }
        case 'barn-doors': {
            const easeBarn = easeOutCubic(p);
            return role === 'main' ? { scale: 0.5 + 0.5 * easeBarn, opacity: easeBarn } : { opacity: outP };
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
                ? { scale: easeP, opacity: easeP }
                : { opacity: outP };
        }

        // Simple wipe - basic directional wipe
        case 'simple-wipe': {
            const easeWipe = easeOutCubic(p);
            if (direction === 'right') {
                return role === 'main' ? { clipX: 0, clipWidth: easeWipe } : {};
            } else if (direction === 'left') {
                return role === 'main' ? { clipX: 1 - easeWipe, clipWidth: easeWipe } : {};
            }
            return role === 'main' ? { clipX: 0, clipWidth: easeWipe } : {};
        }

        // Multi-panel - slides in with scale
        case 'multi-panel': {
            return role === 'main'
                ? { clipWidth: p, scale: 0.8 + 0.2 * p, opacity: p }
                : { opacity: outP };
        }

        // Split screen - opens from center
        case 'split-screen': {
            const easeP = easeOutCubic(p);
            return role === 'main'
                ? { scale: easeP, opacity: easeP }
                : { opacity: outP };
        }

        // Shape transitions
        case 'shape-circle': {
            const easeP = easeOutCubic(p);
            return role === 'main'
                ? { scale: easeP, opacity: easeP }
                : { opacity: outP };
        }
        case 'shape-heart':
        case 'shape-triangle': {
            const easeP = easeOutCubic(p);
            return role === 'main'
                ? { scale: 0.5 + 0.5 * easeP, opacity: easeP }
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

        // Random blocks (simplified to fade)
        case 'random-blocks':
        case 'checker-wipe':
        case 'venetian-blinds':
        case 'zig-zag':
        case 'band-wipe':
        case 'wedge-wipe':
        case 'clock-wipe':
        case 'radial-wipe':
            return role === 'main' ? { opacity: p } : { opacity: outP };

        // DEFAULT
        default:
            return { opacity: role === 'main' ? p : outP };
    }
}
