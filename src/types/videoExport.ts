// ============================================
// Video Export Types
// Types for server-side video export with FFmpeg
// ============================================

export interface ExportJob {
    id: string;
    userId: string;
    status: 'pending' | 'uploading' | 'processing' | 'encoding' | 'complete' | 'error';
    progress: number;
    createdAt: Date;
    updatedAt: Date;
    timeline?: TimelineData;
    settings?: ExportSettings;
    outputUrl?: string;
    error?: string;
}

export interface TimelineData {
    tracks: TrackData[];
    duration: number;
    dimension: {
        width: number;
        height: number;
    };
}

export interface TrackData {
    id: string;
    type: 'video' | 'audio' | 'overlay';
    items: TimelineItemData[];
}

export interface TimelineItemData {
    id: string;
    type: 'video' | 'image' | 'audio' | 'text' | 'color';
    src: string;       // Original source URL
    localPath?: string; // Local path after upload
    dataUrl?: string;   // Base64 data URL for Puppeteer rendering
    name: string;
    start: number;
    duration: number;
    offset: number;
    trimStart?: number;  // Trim start time within source media
    trimEnd?: number;    // Trim end time within source media

    // Transforms
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    rotation?: number;
    opacity?: number;
    flipH?: boolean;
    flipV?: boolean;

    // Styling
    isBackground?: boolean;
    fit?: 'contain' | 'cover' | 'fill';

    // Filters
    brightness?: number;
    contrast?: number;
    saturation?: number;
    blur?: number;
    filter?: string;

    // Animation
    animation?: {
        type: string;
        duration: number;
        timing: 'enter' | 'exit' | 'both';
    };

    // Transition
    transition?: {
        type: string;
        duration: number;
        speed?: number; // 0.1 (slow) to 2.0 (fast)
        direction?: 'left' | 'right' | 'up' | 'down';
        timing?: 'prefix' | 'postfix' | 'overlap';
    };

    // Border
    border?: {
        width: number;
        color: string;
    };

    // Crop
    crop?: {
        x: number;
        y: number;
        zoom: number;
    };

    // Layer ordering
    layer?: number;

    // Text properties
    fontSize?: number;
    fontFamily?: string;
    color?: string;
    fontWeight?: string;
    fontStyle?: string;
    textAlign?: string;
    verticalAlign?: string;  // top, middle, bottom
    textDecoration?: string;
    textTransform?: string;
    letterSpacing?: number;
    listType?: string;
    textEffect?: {
        type: string;
        color?: string;
        intensity?: number;
        offset?: number;
    };

    // Image/Video adjustments (detailed)
    filterIntensity?: number;  // 0-100
    adjustments?: {
        temperature?: number;
        tint?: number;
        brightness?: number;
        contrast?: number;
        highlights?: number;
        shadows?: number;
        whites?: number;
        blacks?: number;
        saturation?: number;
        vibrance?: number;
        hue?: number;
        sharpness?: number;
        clarity?: number;
        vignette?: number;
    };

    // Audio flag for video items
    hasAudio?: boolean; // Set to true if video has audio stream
    muteVideo?: boolean; // Set to true if user clicked "Remove Audio" in editor
}

export interface ExportSettings {
    resolution: {
        width: number;
        height: number;
    };
    fps: number;
    quality: 'low' | 'medium' | 'high';
    format: 'mp4' | 'webm' | 'mov' | 'mkv' | 'avi';
    useHardwareAccel: boolean;
}

export interface StartExportRequest {
    timeline: TimelineData;
    settings: ExportSettings;
}

export interface StartExportResponse {
    jobId: string;
    uploadUrls: { [assetId: string]: string };
}

export interface ExportStatusResponse {
    status: ExportJob['status'];
    progress: number;
    downloadUrl?: string;
    error?: string;
}
