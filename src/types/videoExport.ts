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
    name: string;
    start: number;
    duration: number;
    offset: number;

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
    };

    // Text properties
    fontSize?: number;
    fontFamily?: string;
    color?: string;
    fontWeight?: string;
    textEffect?: {
        type: string;
        color?: string;
        intensity?: number;
        offset?: number;
    };
}

export interface ExportSettings {
    resolution: {
        width: number;
        height: number;
    };
    fps: number;
    quality: 'low' | 'medium' | 'high';
    format: 'mp4' | 'webm';
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
