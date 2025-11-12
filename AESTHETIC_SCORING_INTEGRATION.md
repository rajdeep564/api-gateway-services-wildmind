# Aesthetic Scoring Integration

## Overview
Automatic aesthetic scoring has been integrated into all generation services. Every generated image and video is now scored using an external aesthetic API, and the score is saved to Firebase for filtering in the Artstation feed.

## Architecture

### Aesthetic Score Service
**File**: `src/services/aestheticScoreService.ts`

- **scoreImage(url)**: Downloads and scores a single image
- **scoreVideo(url)**: Downloads and scores a single video
- **scoreImages(images[])**: Scores multiple images in parallel
- **scoreVideos(videos[])**: Scores multiple videos in parallel
- **getHighestScore(assets[])**: Returns the highest score from a collection

### API Configuration
- **Base URL**: `https://0faa6933d5e8.ngrok-free.app`
- **Endpoints**:
  - `POST /score/image` - Score an image file
  - `POST /score/video` - Score a video file
- **Request Format**: `multipart/form-data` with file upload
- **Response Format**: `{ aesthetic_score: number }`

## Database Schema Updates

### TypeScript Types
**File**: `src/types/generate.ts`

```typescript
export interface ImageMedia {
  id: string;
  url: string;
  storagePath?: string;
  originalUrl?: string;
  aestheticScore?: number;  // ✨ NEW
}

export interface VideoMedia {
  id: string;
  url: string;
  storagePath?: string;
  thumbUrl?: string;
  aestheticScore?: number;  // ✨ NEW
}

export interface GenerationHistoryItem {
  // ... existing fields
  aestheticScore?: number;  // ✨ NEW - Highest score among all images/videos
}
```

### Firestore Collections
Both `generationHistory/{uid}/items/{historyId}` and `generations/{historyId}` (public mirror) now store:
- **Individual asset scores**: Each image/video object has `aestheticScore` field
- **Highest score**: Generation document has top-level `aestheticScore` field

## Integration Points

### 1. BFL Service (Flux Models)
**File**: `src/services/bflService.ts`

**Functions Updated**:
- `generate()` - Main text-to-image generation
- `fill()` - Inpainting
- `expand()` - Outpainting
- `canny()` - Canny edge control
- `depth()` - Depth control
- `expandWithFill()` - Fill-based expansion

**Flow**:
```typescript
// After image upload to Zata
const scoredImages = await aestheticScoreService.scoreImages(storedImages);
const highestScore = aestheticScoreService.getHighestScore(scoredImages);

await generationHistoryRepository.update(uid, historyId, {
  status: 'completed',
  images: scoredImages,
  aestheticScore: highestScore,
});

await syncToMirror(uid, historyId); // Syncs scores to public feed
```

### 2. MiniMax Service
**File**: `src/services/minimaxService.ts`

**Functions Updated**:
- `generate()` - Text-to-image
- `videoGenerateAndStore()` - Text-to-video (Hailuo)

**Special Handling**: Video scoring occurs in both success and fallback paths (with/without Zata upload)

### 3. Runway Service
**File**: `src/services/runwayService.ts`

**Functions Updated**:
- `checkStatus()` - Async task completion handler

**Flow**: Scores images/videos when task status changes to `SUCCEEDED`, handles both image-to-video and text-to-image modes

### 4. FAL Service
**File**: `src/services/falService.ts`

**Functions Updated**:
- `generate()` - Background scoring after Zata upload (setImmediate)
- `veoTextToVideo()` - VEO 3 text-to-video
- `veoTextToVideoFast()` - VEO 3 fast text-to-video
- `veoImageToVideo()` - VEO 3 image-to-video
- `veoImageToVideoFast()` - VEO 3 fast image-to-video

**Special Note**: FAL uses background upload pattern with `setImmediate()` for quick response, scoring happens in background

### 5. Replicate Service
**File**: `src/services/replicateService.ts`

**Functions Updated**:
- `removeBackground()` - Background removal
- `upscale()` - Image upscaling (multiple models)
- `generateImage()` - Text-to-image (SeDream, etc.)
- `wanI2V()` - WAN 2.5 image-to-video
- `wanT2V()` - WAN 2.5 text-to-video

## Error Handling

### Graceful Degradation
All scoring calls are wrapped in try-catch blocks within the scoring service:
- If download fails → returns `null` score
- If API call fails → returns `null` score
- If parsing fails → returns `null` score
- Individual asset failures don't block completion

### Logging
Uses Pino structured logging:
```typescript
logger.info({ imageUrl, score }, '[AestheticScore] Image scored successfully');
logger.error({ imageUrl, error }, '[AestheticScore] Failed to score image');
```

## Usage in Frontend

### Filtering High-Quality Content
Filter generations with scores >= 8.5 for Artstation feed:

```typescript
// Firestore query example
const q = query(
  collection(db, 'generations'),
  where('aestheticScore', '>=', 8.5),
  where('isPublic', '==', true),
  orderBy('aestheticScore', 'desc'),
  orderBy('createdAt', 'desc')
);
```

### Display Score in UI
```typescript
<div>
  {generation.aestheticScore && (
    <Badge>
      ⭐ {generation.aestheticScore.toFixed(1)}
    </Badge>
  )}
</div>
```

## Performance Considerations

### Timeout Configuration
- **Image downloads**: 30s timeout
- **Image scoring API**: 60s timeout
- **Video downloads**: 60s timeout
- **Video scoring API**: 120s timeout

### Parallel Processing
- Multiple images/videos in a generation are scored in parallel using `Promise.all()`
- Does not block generation completion response to user

### Network Impact
- Downloads occur server-side (backend → provider → backend → scoring API)
- User receives completion immediately after upload to Zata
- Scoring happens asynchronously in most cases

## Testing

### Manual Testing
```bash
# Test image scoring endpoint directly
curl -X POST https://0faa6933d5e8.ngrok-free.app/score/image \
  -H "accept: application/json" \
  -F "file=@test-image.jpg"

# Test video scoring endpoint
curl -X POST https://0faa6933d5e8.ngrok-free.app/score/video \
  -H "accept: application/json" \
  -F "file=@test-video.mp4"
```

### Check Firestore
```javascript
// View generation with scores
const doc = await getDoc(doc(db, 'generations', historyId));
console.log(doc.data().aestheticScore); // Top-level score
console.log(doc.data().images[0].aestheticScore); // Per-image score
```

## Future Enhancements

### Planned Features
1. **Score caching**: Cache scores by content hash to avoid re-scoring identical outputs
2. **Batch API**: If scoring API supports batch requests, optimize to send multiple files at once
3. **Score analytics**: Track score distributions per model/provider
4. **User preferences**: Allow users to set minimum score thresholds for their feed
5. **Score explanation**: If API provides breakdown, store reasoning

### API Changes Needed
If ngrok URL changes, update:
```typescript
// src/services/aestheticScoreService.ts
const AESTHETIC_API_BASE = 'https://YOUR-NEW-NGROK-URL.ngrok-free.app';
```

## Monitoring

### Key Metrics
- **Scoring success rate**: % of generations with non-null scores
- **Average scoring time**: Time from generation completion to score saved
- **Score distribution**: Histogram of scores per provider
- **Failed scoring**: Count of null scores with error reasons

### Logging Patterns
```
[AestheticScore] Scoring image { imageUrl: '...' }
[AestheticScore] Image scored successfully { imageUrl: '...', score: 7.45 }
[AestheticScore] Failed to score image { imageUrl: '...', error: 'timeout' }
```

## Troubleshooting

### Scores Not Appearing
1. Check ngrok tunnel is active
2. Verify API is running on port
3. Check backend logs for `[AestheticScore]` errors
4. Ensure network connectivity from backend to ngrok URL

### Low Scores
- Scoring model may have different aesthetic preferences
- Test with known high-quality images to calibrate expectations
- Check if model is trained for specific content types

### Timeout Errors
- Increase timeout values in `aestheticScoreService.ts`
- Check network latency between backend and scoring API
- Consider async processing for video scoring (currently synchronous)

## Migration Notes

### Existing Generations
Generations created before this integration will not have `aestheticScore` fields. To backfill:

```typescript
// Example backfill script (not included)
async function backfillScores() {
  const generations = await generationHistoryRepository.list(uid, { limit: 100 });
  for (const gen of generations.items) {
    if (!gen.aestheticScore && gen.images?.length) {
      const scoredImages = await aestheticScoreService.scoreImages(gen.images);
      const highestScore = aestheticScoreService.getHighestScore(scoredImages);
      await generationHistoryRepository.update(uid, gen.id, {
        images: scoredImages,
        aestheticScore: highestScore,
      });
    }
  }
}
```

## Dependencies

### New Packages
- **multer**: Already installed for file upload handling (not used in final implementation)
- **form-data**: Built-in Node.js module for multipart/form-data
- **axios**: Already present for HTTP requests

### No Breaking Changes
- All fields are optional (`aestheticScore?: number`)
- Backward compatible with existing generation objects
- Frontend can safely check for score existence before displaying

---

**Integration Complete** ✅

All image and video generations now include aesthetic quality scores automatically saved to Firebase. Filter the public feed (`generations` collection) by `aestheticScore >= 8.5` to show only high-quality content in Artstation.
