# Video Generation Canvas Integration

## Overview
This document describes the complete integration of all 21 video generation models with the canvas frontend. The backend now routes video generation requests from the canvas to the appropriate service (FAL, Replicate, MiniMax, or Runway) based on the selected model.

## Model Mapping

### FAL Service Models (7 models)
- **Sora 2 Pro**: `sora2ProT2vSubmit` - Duration as number, supports 720p/1080p
- **Veo 3.1 Pro**: `veo31TtvSubmit` (fast=false) - Duration as "8s" string, supports 720p/1080p
- **Veo 3.1 Fast Pro**: `veo31TtvSubmit` (fast=true) - Duration as "8s" string, supports 720p/1080p
- **Veo 3 Pro**: `veoTtvSubmit` (fast=false) - Duration as "8s" string, supports 720p/1080p
- **Veo 3 Fast Pro**: `veoTtvSubmit` (fast=true) - Duration as "8s" string, supports 720p/1080p
- **LTX V2 Pro**: `ltx2ProT2vSubmit` - Duration as number, supports 1080p/1440p/2160p
- **LTX V2 Fast**: `ltx2FastT2vSubmit` - Duration as number, supports 1080p/1440p/2160p

### Replicate Service Models (8 models)
- **Seedance 1.0 Pro**: `seedanceT2vSubmit` - Supports 480p/720p/1080p, 2-12s duration
- **Seedance 1.0 Lite**: `seedanceT2vSubmit` - Supports 480p/720p/1080p, 2-12s duration
- **PixVerse v5**: `pixverseT2vSubmit` - Uses "quality" parameter, supports 360p/540p/720p/1080p
- **WAN 2.5**: `wanT2vSubmit` (fast=false) - Uses "size" parameter, supports 480p/720p/1080p
- **WAN 2.5 Fast**: `wanT2vSubmit` (fast=true) - Uses "size" parameter, supports 480p/720p/1080p
- **Kling 2.5 Turbo Pro**: `klingT2vSubmit` (mode='pro') - Supports 720p/1080p via mode
- **Kling 2.1**: `klingT2vSubmit` (mode='standard') - Supports 720p/1080p via mode
- **Kling 2.1 Master Pro**: `klingT2vSubmit` (mode='pro') - Supports 720p/1080p via mode

### MiniMax Service Models (4 models)
- **MiniMax-Hailuo-02**: `generateVideo` - Supports 512P/768P/1080P, 6s/10s duration
- **T2V-01-Director**: `generateVideo` - Fixed 720P, 6s duration
- **I2V-01-Director**: `generateVideo` - Fixed 720P, 6s duration
- **S2V-01**: `generateVideo` - Fixed 720P, 6s duration

### Runway Service Models (2 models)
- **Gen-4 Turbo**: `videoGenerate` (mode='text_to_video') - Supports 1280:720, 720:1280, etc.
- **Gen-3a Turbo**: `videoGenerate` (mode='text_to_video') - Supports 1280:768, 768:1280

## Parameter Handling

### Duration
- **FAL Sora 2 & LTX**: Passed as number (e.g., 8)
- **FAL Veo**: Passed as string (e.g., "8s")
- **Replicate**: Passed as number (e.g., 5)
- **MiniMax**: Passed as number (e.g., 6)
- **Runway**: Passed as number (e.g., 5)

### Resolution
- **FAL**: Passed as "720p" or "1080p" string
- **Replicate Seedance/Kling**: Passed as "480p", "720p", or "1080p"
- **Replicate PixVerse**: Passed as "quality" parameter ("360p", "540p", "720p", "1080p")
- **Replicate WAN**: Converted to "size" parameter ("832*480", "1280*720", "1920*1080")
- **MiniMax**: Passed as "512P", "768P", or "1080P" (uppercase)
- **Runway**: Not directly used (aspect ratio determines resolution)

### Aspect Ratio
- **FAL**: Passed as "16:9", "9:16", "1:1" string
- **Replicate**: Passed as "16:9", "9:16", etc. string
- **MiniMax**: Not directly used (model-specific)
- **Runway**: Converted from "16:9" to "1280:720" format based on model

## Implementation Details

### Model Mapping Function
The `mapVideoModelToBackend()` function maps frontend model names (e.g., "Sora 2 Pro") to:
- Service type (fal, replicate, minimax, runway)
- Service method name
- Backend model identifier
- Additional flags (isFast, mode)

### Service Routing
The `generateVideoForCanvas()` function:
1. Maps the frontend model to backend configuration
2. Routes to the appropriate service based on model
3. Formats parameters according to service requirements
4. Calls the service method with correct parameters
5. Returns taskId and historyId for polling

### Error Handling
- Validates service availability
- Validates method existence
- Provides detailed error messages
- Logs all routing decisions for debugging

## Frontend Integration

The frontend (`VideoUploadModal.tsx`) now:
- Shows dynamic resolution dropdown based on selected model
- Shows dynamic duration dropdown based on selected model
- Shows dynamic aspect ratio dropdown based on selected model
- Automatically adjusts parameters when model changes
- Passes all parameters (model, duration, resolution, aspect ratio) to backend

## API Endpoint

**POST** `/canvas/generate-video`

**Request Body:**
```json
{
  "prompt": "A dog running in a park",
  "model": "Sora 2 Pro",
  "aspectRatio": "16:9",
  "duration": 8,
  "resolution": "1080p",
  "meta": {
    "source": "canvas",
    "projectId": "project-123"
  }
}
```

**Response:**
```json
{
  "status": "success",
  "message": "Video generation started",
  "data": {
    "mediaId": "",
    "url": "",
    "storagePath": "",
    "generationId": "history-456",
    "taskId": "task-789"
  }
}
```

## Testing Checklist

- [ ] Test all 21 models with valid parameters
- [ ] Test parameter validation (invalid duration/resolution for each model)
- [ ] Test model switching (parameter auto-adjustment)
- [ ] Test error handling (missing API keys, invalid models)
- [ ] Test queue polling for all services
- [ ] Verify video URLs are returned correctly after generation

## Notes

- All video generation is queue-based (async)
- Frontend must poll for completion using taskId/historyId
- Resolution parameter format varies by service (pixverse uses "quality", wan uses "size")
- Duration format varies by service (FAL Veo uses "8s" string, others use number)
- Runway aspect ratios are converted to pixel format (e.g., "16:9" → "1280:720")

