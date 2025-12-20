# Provider Services Refactoring Plan

## Overview

All major AI provider services need to be split into smaller, maintainable modules. This document outlines the refactoring plan for each provider.

---

## File Sizes Summary

| Service | Current Lines | Priority | Split Target |
|---------|--------------|----------|--------------|
| `replicateService.ts` | **5,318** | 🔴 Critical | 4-5 modules |
| `falService.ts` | **3,854** | 🔴 Critical | 5-6 modules |
| `canvas/generateService.ts` | **3,154** | 🔴 Critical | 4-5 modules |
| `bflService.ts` | **962** | 🟡 High | 3-4 modules |
| `minimaxService.ts` | **719** | 🟡 High | 3 modules |
| `runwayService.ts` | **623** | 🟠 Medium | 2-3 modules |

**Total Lines to Refactor**: ~15,630 lines

---

## 1. replicateService.ts (5,318 lines) 🔴

### Current Structure
- Single monolithic file with 23+ exported functions
- Mix of image, video, and queue operations
- Shared utilities scattered throughout

### Proposed Split

```
src/services/replicate/
├── index.ts (re-exports everything)
├── replicateUtils.ts (~200 lines)
│   - ensureReplicate()
│   - getLatestModelVersion()
│   - resolveItemUrl()
│   - resolveOutputUrls()
│   - buildReplicateImageFileName()
│   - composeModelSpec()
│   - clamp()
│   - downloadToDataUri()
│   - extractFirstUrl()
│   - resolveWanModelFast()
│   - Constants (DEFAULT_BG_MODEL_A, DEFAULT_BG_MODEL_B, etc.)
│   - Types (SubmitReturn)
│
├── replicateImageService.ts (~1,500 lines)
│   - removeBackground()
│   - upscale()
│   - generateImage()
│   - multiangle()
│   - nextScene()
│
├── replicateVideoService.ts (~3,000 lines)
│   - wanI2V()
│   - wanT2V()
│   - wanT2vSubmit()
│   - wanI2vSubmit()
│   - klingT2vSubmit()
│   - klingI2vSubmit()
│   - klingLipsyncSubmit()
│   - wanAnimateReplaceSubmit()
│   - wanAnimateAnimationSubmit()
│   - seedanceT2vSubmit()
│   - seedanceI2vSubmit()
│   - seedanceProFastT2vSubmit()
│   - seedanceProFastI2vSubmit()
│   - pixverseT2vSubmit()
│   - pixverseI2vSubmit()
│
└── replicateQueueService.ts (~600 lines)
    - replicateQueueStatus()
    - waitForPrediction()
    - replicateQueueResult()
```

### Main Service Export (backward compatibility)
```typescript
// replicateService.ts (updated to re-export)
export * from './replicate';
export { replicateService } from './replicate';
```

---

## 2. falService.ts (3,854 lines) 🔴

### Current Structure
- Two main exports: `falService` and `falQueueService`
- Mix of image generation, image utilities, video generation, and queue operations
- Many utility functions for specific models (Bria, Topaz, Recraft, Veo, Kling, Sora, LTX)

### Proposed Split

```
src/services/fal/
├── index.ts (re-exports everything)
├── falUtils.ts (~150 lines)
│   - resizeImageTo1MP()
│   - buildFalApiError()
│   - queueCreateHistory()
│   - persistInputImagesFromUrls()
│   - Types (SubmitReturn)
│
├── falImageService.ts (~1,200 lines)
│   - generate() (main image generation)
│
├── falImageUtilityService.ts (~1,500 lines)
│   - briaExpandImage()
│   - outpaintImage()
│   - topazUpscaleImage()
│   - recraftVectorize()
│   - briaGenfill()
│   - image2svg()
│   - birefnetVideo() (video background removal)
│
├── falVideoService.ts (~600 lines)
│   - veoTextToVideo()
│   - veoTextToVideoFast()
│   - veoImageToVideo()
│   - veoImageToVideoFast()
│
└── falQueueService.ts (~1,400 lines)
    - veoTtvSubmit()
    - veoI2vSubmit()
    - klingO1FirstLastSubmit()
    - klingO1ReferenceSubmit()
    - veo31TtvSubmit()
    - veo31I2vSubmit()
    - sora2I2vSubmit()
    - sora2ProI2vSubmit()
    - sora2RemixV2vSubmit()
    - sora2T2vSubmit()
    - sora2ProT2vSubmit()
    - ltx2I2vSubmit()
    - ltx2ProI2vSubmit()
    - ltx2FastI2vSubmit()
    - ltx2T2vSubmit()
    - ltx2ProT2vSubmit()
    - ltx2FastT2vSubmit()
    - queueStatus()
    - fetchFalQueueResponse()
    - queueResult()
```

### Main Service Export (backward compatibility)
```typescript
// falService.ts (updated to re-export)
export * from './fal';
export { falService, falQueueService } from './fal';
```

---

## 3. bflService.ts (962 lines) 🟡

### Current Structure
- Single service with image generation and utility functions
- Mix of generation, editing, and utility operations

### Proposed Split

```
src/services/bfl/
├── index.ts (re-exports everything)
├── bflUtils.ts (~150 lines)
│   - normalizeToBase64()
│   - pollForResults()
│
├── bflImageService.ts (~400 lines)
│   - generate() (main image generation)
│
└── bflUtilityService.ts (~400 lines)
    - fill()
    - expand()
    - expandWithFill()
    - canny()
    - depth()
```

### Main Service Export (backward compatibility)
```typescript
// bflService.ts (updated to re-export)
export * from './bfl';
export { bflService } from './bfl';
```

---

## 4. minimaxService.ts (719 lines) 🟡

### Current Structure
- Single service with image, video, and music generation

### Proposed Split

```
src/services/minimax/
├── index.ts (re-exports everything)
├── minimaxUtils.ts (~100 lines)
│   - mapMiniMaxCodeToHttp()
│   - assertMiniMaxOk()
│   - Shared types
│
├── minimaxImageService.ts (~200 lines)
│   - generate()
│
├── minimaxVideoService.ts (~300 lines)
│   - generateVideo()
│   - getVideoStatus()
│   - getFile()
│   - processVideoFile()
│
└── minimaxMusicService.ts (~100 lines)
    - generateMusic()
    - musicGenerateAndStore()
```

### Main Service Export (backward compatibility)
```typescript
// minimaxService.ts (updated to re-export)
export * from './minimax';
export { minimaxService } from './minimax';
```

---

## 5. runwayService.ts (623 lines) 🟠

### Current Structure
- Single service with image and video generation
- Relatively smaller but still should be split

### Proposed Split

```
src/services/runway/
├── index.ts (re-exports everything)
├── runwayUtils.ts (~50 lines)
│   - getRunwayClient()
│
├── runwayImageService.ts (~150 lines)
│   - textToImage()
│
└── runwayVideoService.ts (~400 lines)
    - videoGenerate()
    - getStatus()
    - characterPerformance()
```

### Main Service Export (backward compatibility)
```typescript
// runwayService.ts (updated to re-export)
export * from './runway';
export { runwayService } from './runway';
```

---

## Implementation Strategy

### Phase 1: Replicate Service (Priority 1)
1. Create `src/services/replicate/` directory
2. Extract utilities first (safest)
3. Extract image service
4. Extract video service
5. Extract queue service
6. Create index.ts
7. Update main replicateService.ts to re-export

### Phase 2: FAL Service (Priority 2)
1. Create `src/services/fal/` directory
2. Extract utilities
3. Extract image service
4. Extract image utility service
5. Extract video service
6. Extract queue service
7. Create index.ts
8. Update main falService.ts to re-export

### Phase 3: BFL Service (Priority 3)
1. Create `src/services/bfl/` directory
2. Extract utilities
3. Extract image service
4. Extract utility service
5. Create index.ts
6. Update main bflService.ts to re-export

### Phase 4: MiniMax Service (Priority 4)
1. Create `src/services/minimax/` directory
2. Extract utilities
3. Extract image service
4. Extract video service
5. Extract music service
6. Create index.ts
7. Update main minimaxService.ts to re-export

### Phase 5: Runway Service (Priority 5)
1. Create `src/services/runway/` directory
2. Extract utilities
3. Extract image service
4. Extract video service
5. Create index.ts
6. Update main runwayService.ts to re-export

---

## Common Patterns Across All Services

### Shared Imports (should be consistent)
```typescript
// Common across all services
import { ApiError } from '../utils/errorHandler';
import { env } from '../config/env';
import { generationHistoryRepository } from '../repository/generationHistoryRepository';
import { authRepository } from '../repository/auth/authRepository';
import { uploadFromUrlToZata, uploadDataUriToZata } from '../utils/storage/zataUpload';
import { syncToMirror, updateMirror } from '../utils/mirrorHelper';
import { aestheticScoreService } from '../services/aestheticScoreService';
import { markGenerationCompleted } from '../services/generationHistoryService';
```

### Error Handling Pattern (standardize)
```typescript
try {
  // Service logic
} catch (err: any) {
  // Standardized error handling
  await generationHistoryRepository.update(uid, historyId, {
    status: 'failed',
    error: err.message
  });
  throw new ApiError('Operation failed', 502, err);
}
```

---

## Benefits of This Refactoring

1. **Maintainability**: Each module has a single responsibility
2. **Testability**: Easier to unit test individual modules
3. **Discoverability**: Clear structure makes it easy to find code
4. **Performance**: Better tree-shaking, smaller bundles
5. **Code Review**: Smaller files are easier to review
6. **Merge Conflicts**: Less likely with smaller files
7. **Onboarding**: New developers can understand structure faster

---

## Testing Strategy

1. **Unit Tests**: Test each module independently
2. **Integration Tests**: Test that re-exports work correctly
3. **End-to-End Tests**: Verify API endpoints still work
4. **Backward Compatibility**: Ensure existing imports still work

---

## Migration Checklist

For each service:
- [ ] Create directory structure
- [ ] Extract utilities module
- [ ] Extract service modules
- [ ] Create index.ts with re-exports
- [ ] Update main service file to re-export
- [ ] Update all imports (if needed)
- [ ] Run tests
- [ ] Verify backward compatibility
- [ ] Update documentation

---

**Status**: Planning Complete, Ready for Implementation
