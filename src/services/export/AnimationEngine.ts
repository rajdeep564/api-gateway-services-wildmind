// ============================================
// Animation Engine for Server-Side Video Export
// Ports animation calculations from FFmpegExportService.ts
// ============================================

import type { TimelineItemData } from '../../types/videoExport';

export interface AnimationStyle {
    opacity?: number;
    scale?: number;
    scaleX?: number;
    scaleY?: number;
    rotate?: number;
    translateX?: number;
    translateY?: number;
    blur?: number;
}

/**
 * Calculate animation style based on current time
 * Matches CSS keyframes in animations.css exactly
 */
export function calculateAnimationStyle(item: TimelineItemData, currentTime: number): AnimationStyle {
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

    // CSS cubic-bezier(0.2, 0.8, 0.2, 1) approximation
    const cubicBezier = (t: number): number => {
        return t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2;
    };

    const p = cubicBezier(progress);
    const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

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
        case 'flash-drop': return { translateY: -50 + 50 * p, opacity: p, blur: 10 * (1 - p) };
        case 'flash-open': return { scale: 0.5 + 0.5 * p, opacity: p };
        case 'black-hole': return { scale: p, rotate: 180 - 180 * p, opacity: p };
        case 'screen-flicker':
            if (progress < 0.2) return { opacity: progress * 2.5 };
            if (progress < 0.4) return { opacity: 0.2 + 0.3 * Math.random() };
            if (progress < 0.6) return { opacity: 0.5 + 0.5 * ((progress - 0.4) / 0.2) };
            if (progress < 0.8) return { opacity: 0.8 + 0.2 * Math.random() };
            return { opacity: 1 };

        case 'pixelated-motion': return { opacity: p, blur: 10 * (1 - p) };

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
                return { scaleY: 0.01, scaleX: t, opacity: t };
            } else {
                const t = (progress - 0.5) / 0.5;
                return { scaleY: lerp(0.01, 1, t), scaleX: 1, opacity: 1 };
            }

        case 'round-open': return { scale: p, opacity: p };
        case 'expansion': return { scaleX: p, opacity: p };
        case 'shard-roll': return { rotate: 360 - 360 * p, scale: p, opacity: p };

        case 'flip-down-1':
        case 'flip-down-2':
            return { scale: 0.3 + 0.7 * p, translateY: -20 + 20 * p, opacity: p };
        case 'flip-up-1':
        case 'flip-up-2':
            return { scale: 0.3 + 0.7 * p, translateY: 20 - 20 * p, opacity: p };

        case 'fly-in-rotate': return { translateX: -100 + 100 * p, rotate: -90 + 90 * p, opacity: p };
        case 'fly-in-flip': {
            const flipScale = Math.abs(Math.cos((1 - p) * Math.PI / 2));
            return { translateX: -100 + 100 * p, scaleX: flipScale, opacity: p };
        }
        case 'fly-to-zoom': return { scale: p, translateX: -100 + 100 * p, opacity: p };

        case 'grow-shrink':
            if (progress < 0.6) {
                const t = progress / 0.6;
                return { scale: 0.5 + 0.6 * t, opacity: Math.min(1, t * 1.5) };
            } else {
                const t = (progress - 0.6) / 0.4;
                return { scale: 1.1 - 0.1 * t, opacity: 1 };
            }

        case 'stretch-in-left':
            return { scaleX: 2 - p, translateX: -50 + 50 * p, opacity: p, blur: 5 * (1 - p) };
        case 'stretch-in-right':
            return { scaleX: 2 - p, translateX: 50 - 50 * p, opacity: p, blur: 5 * (1 - p) };
        case 'stretch-in-up':
            return { scaleY: 2 - p, translateY: 50 - 50 * p, opacity: p, blur: 5 * (1 - p) };
        case 'stretch-in-down':
            return { scaleY: 2 - p, translateY: -50 + 50 * p, opacity: p, blur: 5 * (1 - p) };
        case 'stretch-to-full':
            return { scale: 0.5 + 0.5 * p, opacity: p };

        case 'to-left-1': return { translateX: 100 - 100 * p, opacity: p };
        case 'to-left-2': return { translateX: 50 - 50 * p, opacity: p };
        case 'to-right-1': return { translateX: -100 + 100 * p, opacity: p };
        case 'to-right-2': return { translateX: -50 + 50 * p, opacity: p };

        case 'up-down-1':
        case 'shake-up-down':
            if (progress < 0.2) return { translateY: -20 + 40 * (progress / 0.2), opacity: Math.min(1, progress * 5) };
            if (progress < 0.4) return { translateY: 20 - 30 * ((progress - 0.2) / 0.2), opacity: 1 };
            if (progress < 0.6) return { translateY: -10 + 20 * ((progress - 0.4) / 0.2), opacity: 1 };
            if (progress < 0.8) return { translateY: 10 - 15 * ((progress - 0.6) / 0.2), opacity: 1 };
            return { translateY: -5 + 5 * ((progress - 0.8) / 0.2), opacity: 1 };

        case 'up-down-2':
            return { translateY: 20 - 20 * p, opacity: p };

        case 'pan-enter-left':
            return { translateX: -100 + 100 * p, opacity: p };
        case 'pan-enter-right':
            return { translateX: 100 - 100 * p, opacity: p };

        case 'tiny-zoom':
            return { scale: 0.1 + 0.9 * p, opacity: p };
        case 'zoom-in-center':
            return { scale: p, opacity: p };
        case 'zoom-in-left':
        case 'zoom-in-right':
        case 'zoom-in-top':
        case 'zoom-in-bottom':
            return { scale: p, opacity: p };
        case 'zoom-in-1':
            if (progress < 0.6) {
                const t = progress / 0.6;
                return { scale: 0.5 + 0.6 * t, opacity: t };
            } else {
                const t = (progress - 0.6) / 0.4;
                return { scale: 1.1 - 0.1 * t, opacity: 1 };
            }
        case 'zoom-in-2':
            return { scale: 0.2 + 0.8 * p, opacity: p };
        case 'zoom-out-1':
            return { scale: 1.5 - 0.5 * p, opacity: p };
        case 'zoom-out-2':
            return { scale: 2 - p, opacity: p };
        case 'zoom-out-3':
            return { scale: 3 - 2 * p, opacity: p, blur: 5 * (1 - p) };
        case 'wham':
            return { scale: 2 - p, rotate: 10 - 10 * p, opacity: p, blur: 10 * (1 - p) };

        case 'blurry-eject':
            if (progress < 0.6) {
                const t = progress / 0.6;
                return { scale: 0.5 + 0.55 * t, opacity: t, blur: 5 * (1 - t) };
            } else {
                const t = (progress - 0.6) / 0.4;
                return { scale: 1.05 - 0.05 * t, opacity: 1, blur: 0 };
            }

        // Additional animations from the ANIMATIONS list
        case 'rgb-drop':
            return { translateY: -50 + 50 * p, opacity: p, scale: 0.8 + 0.2 * p };
        case 'tear-paper':
            return { translateX: -20 + 20 * p, rotate: -5 + 5 * p, opacity: p };

        default:
            return { opacity: p };
    }
}
