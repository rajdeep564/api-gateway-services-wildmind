# Aesthetic Scoring & Public Visibility System

## 🎯 Overview

This document describes the **Aesthetic Scoring** and **Public Visibility Enforcement** systems integrated into the WildMind AI backend.

---

## 📊 Aesthetic Scoring System

### Purpose
Automatically score every generated image and video using an external aesthetic API to measure quality. Scores are saved to Firebase and synced to the public mirror for filtering high-quality content in the Artstation feed.

### Components

#### 1. **Aesthetic Score Service** (`src/services/aestheticScoreService.ts`)
- **Endpoint**: `https://0faa6933d5e8.ngrok-free.app`
- **Methods**:
  - `scoreImage(url)` - Scores a single image
  - `scoreVideo(url)` - Scores a single video  
  - `scoreImages(images[])` - Batch scores images
  - `scoreVideos(videos[])` - Batch scores videos
  - `getHighestScore(assets[])` - Returns max score from array

#### 2. **Type Updates** (`src/types/generate.ts`)
```typescript
interface ImageMedia {
  id: string;
  url: string;
  storagePath?: string;
  originalUrl?: string;
  aestheticScore?: number; // NEW
}

interface VideoMedia {
  id: string;
  url: string;
  storagePath?: string;
  thumbUrl?: string;
  aestheticScore?: number; // NEW
}

interface GenerationHistoryItem {
  // ... existing fields
  aestheticScore?: number; // Highest score among all images/videos
}
```

#### 3. **Integration Points**
Scoring is integrated into **ALL** generation services:

| Service | Integrated Functions | Asset Type |
|---------|---------------------|------------|
| **bflService** | generate, fill, expand, canny, depth, expandWithFill | Images |
| **minimaxService** | videoGenerateAndStore (both success & fallback paths) | Videos |
| **runwayService** | pollTaskForVideo, generate (Gen-4 Aleph, Gen-4 Turbo, Gen-3a Turbo) | Images & Videos |
| **falService** | Background upload flow for veo, image-to-video, imageGeneration | Images & Videos |
| **replicateService** | remove-bg, upscale, generateImage, generateVideo | Images & Videos |

#### 4. **Data Flow**
```
1. Generation completes → Download image/video URL
2. Send to aesthetic API → Receive score (0-10)
3. Attach score to each asset → Calculate highest score
4. Save to Firebase:
   - User's generationHistory/{uid}/items/{historyId}
   - Public mirror: generations/{historyId}
5. Frontend filters Artstation: Only show aestheticScore >= 8.5
```

---

## 🔒 Public Visibility Enforcement System

### Purpose
**Free plan users** must have ALL generations set to **public**. They cannot toggle to private. **Paid plans** (Plan A, B, C, D) can choose public or private.

### Components

#### 1. **Public Visibility Enforcer** (`src/utils/publicVisibilityEnforcer.ts`)
```typescript
// Check if user is on free plan
await isFreePlanUser(uid) → boolean

// Enforce public visibility for free users
await enforcePublicVisibility(uid, requestedIsPublic) 
→ { isPublic, visibility, reason? }

// Check if user can toggle setting
await canTogglePublicGeneration(uid) → boolean
```

#### 2. **Business Rules**

| Plan | Can Toggle Private? | Default | Enforcement |
|------|-------------------|---------|-------------|
| **FREE** | ❌ No | Public | Always forced to `isPublic: true` |
| **Plan A** | ✅ Yes | User choice | Respects user request |
| **Plan B** | ✅ Yes | User choice | Respects user request |
| **Plan C** | ✅ Yes | User choice | Respects user request |
| **Plan D** | ✅ Yes | User choice | Respects user request |

#### 3. **Integration Status**

✅ **Completed**: bflService → `generate()` function  
🔄 **In Progress**: Other BFL functions (fill, expand, canny, depth, expandWithFill)  
❌ **TODO**: minimaxService, runwayService, falService, replicateService

#### 4. **Example Integration**
```typescript
// Before (bflService.ts - line ~160)
const { historyId } = await generationHistoryRepository.create(uid, {
  isPublic: (payload as any).isPublic === true, // ❌ Trusted user input
  visibility: (payload as any).visibility || "private"
});

// After (with enforcement)
const { isPublic: enforcedIsPublic, visibility: enforcedVisibility } = 
  await publicVisibilityEnforcer.enforcePublicVisibility(uid, isPublic);

const { historyId } = await generationHistoryRepository.create(uid, {
  isPublic: enforcedIsPublic, // ✅ Enforced for free users
  visibility: enforcedVisibility
});
```

---

## 📋 Remaining Work

### Backend Tasks
1. **Integrate `publicVisibilityEnforcer` in**:
   - [ ] bflService: fill, expand, canny, depth, expandWithFill
   - [ ] minimaxService: imageGenerateAndStore, videoGenerate, musicGenerate
   - [ ] runwayService: generate, pollTaskForVideo
   - [ ] falService: All generation endpoints
   - [ ] replicateService: All generation endpoints

2. **Create API Endpoint**:
   - [ ] `GET /api/auth/can-toggle-public` - Returns `{ canToggle: boolean, planCode: string }`
   - [ ] Used by frontend to disable toggle for free users

### Frontend Tasks
1. **Account Settings** (`/settings/account`):
   - [ ] Call `GET /api/auth/can-toggle-public`
   - [ ] If `canToggle === false`: Disable "Public Generation" toggle with tooltip: *"Upgrade to paid plan to make generations private"*
   - [ ] Show current plan badge next to toggle

2. **Generation Forms** (Image/Video/Music/etc):
   - [ ] Call `GET /api/auth/can-toggle-public` on mount
   - [ ] If `canToggle === false`:
     - Lock toggle to "Public" (checked, disabled)
     - Show tooltip: *"Free plan users: All generations are public. Upgrade to make private."*
   - [ ] If `canToggle === true`: Allow user to toggle

3. **Upgrade Prompts**:
   - [ ] Show modal when free user tries to toggle private
   - [ ] Message: *"Want private generations? Upgrade to Plan A or higher!"*
   - [ ] Button: "View Plans" → `/pricing`

---

## 🧪 Testing

### Aesthetic Scoring
```bash
# Test image generation with scoring
curl -X POST http://localhost:5000/api/bfl/generate \
  -H "Cookie: session=..." \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A beautiful sunset",
    "model": "flux-dev",
    "n": 1,
    "frameSize": "1:1"
  }'

# Response should include:
# {
#   "images": [{ "url": "...", "aestheticScore": 7.45 }],
#   "aestheticScore": 7.45  // highest score
# }
```

### Public Visibility
```bash
# Test as FREE user (should force public)
curl -X POST http://localhost:5000/api/bfl/generate \
  -H "Cookie: session=..." \
  -d '{ "prompt": "test", "model": "flux-dev", "isPublic": false }'

# Response should have isPublic: true (enforced)

# Test as PAID user (should respect choice)
# Same request with paid user should respect isPublic: false
```

---

## 🗄️ Database Schema

### Firebase Structure
```
generationHistory/{uid}/items/{historyId}
{
  images: [
    { id, url, storagePath, aestheticScore: 8.2 },
    { id, url, storagePath, aestheticScore: 7.9 }
  ],
  aestheticScore: 8.2,  // Highest
  isPublic: true,
  visibility: "public"
}

generations/{historyId}  // Public mirror
{
  // Same structure, synced via syncToMirror()
}
```

---

## 🔄 Migration Notes

- **No migration needed**: `aestheticScore` is optional field
- Existing generations without scores: Will be `undefined`
- New generations: Automatically scored
- Frontend filter: `WHERE aestheticScore >= 8.5` will work immediately

---

## 📞 API Reference

### Aesthetic API (External)
```typescript
POST https://0faa6933d5e8.ngrok-free.app/score/image
Headers: { accept: "application/json" }
Body: FormData { file: Buffer }
Response: { aesthetic_score: 7.45 }

POST https://0faa6933d5e8.ngrok-free.app/score/video
Headers: { accept: "application/json" }
Body: FormData { file: Buffer }
Response: { aesthetic_score: 8.12 }
```

---

## ⚠️ Known Limitations

1. **Scoring Performance**: 
   - Images: ~3-5 seconds per image
   - Videos: ~10-30 seconds per video
   - Runs in background, doesn't block user response

2. **Failure Handling**:
   - If scoring API fails → Generation still succeeds
   - `aestheticScore` remains `undefined`
   - Logged as warning, not error

3. **Free Plan Detection**:
   - Falls back to FREE if credits API fails
   - Ensures safety: Better to force public than leak private

---

## 📝 Developer Notes

- **Scoring is non-blocking**: Generation completes even if scoring fails
- **Idempotent**: Safe to retry scoring
- **Public enforcement**: Applied at service layer (server-side), not controller
- **Mirror sync**: Aesthetic scores automatically synced to public feed

---

## 🎨 Frontend Filter Example

```typescript
// Artstation feed query (with aesthetic filter)
const query = db.collection('generations')
  .where('isPublic', '==', true)
  .where('aestheticScore', '>=', 8.5)
  .orderBy('aestheticScore', 'desc')
  .limit(50);
```

---

*Last Updated: January 10, 2025*
