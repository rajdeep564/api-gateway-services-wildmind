# PixVerse v5 Code Analysis

## Summary
✅ **PixVerse v5 code IS PRESENT** in the `api-gateway-services-wildmind` backend.

## Complete Code Inventory

### 1. Service Implementation
**File:** `src/services/replicateService.ts`

#### Text-to-Video (T2V) Function
- **Function:** `pixverseT2vSubmit` (lines 2582-2770)
- **Model:** `pixverseai/pixverse-v5`
- **Features:**
  - Supports durations: 5s, 8s
  - Supports quality/resolution: 360p, 540p, 720p, 1080p
  - Supports aspect ratios: 16:9, 9:16, 1:1
  - Optional parameters: seed, negative_prompt
  - **Recent Fix:** Ensures no image/frame parameters are passed for T2V (cleanInput implementation)

#### Image-to-Video (I2V) Function
- **Function:** `pixverseI2vSubmit` (lines 2772-2849)
- **Model:** `pixverseai/pixverse-v5`
- **Features:**
  - Requires: prompt, image
  - Supports durations: 5s, 8s
  - Supports quality/resolution: 360p, 540p, 720p, 1080p
  - Supports aspect ratios: 16:9, 9:16, 1:1
  - Optional parameters: seed, negative_prompt

**Export:** Both functions exported via `Object.assign(replicateService, { pixverseT2vSubmit, pixverseI2vSubmit })` (line 2851)

---

### 2. API Routes
**File:** `src/routes/replicate.ts`

#### T2V Endpoint
- **Route:** `POST /api/replicate/pixverse-v5-t2v/submit`
- **Middleware:**
  - `requireAuth` - Authentication required
  - `validatePixverseT2V` - Input validation
  - `makeCreditCost` - Credit cost calculation
  - `pixverseT2vSubmit` - Controller handler

#### I2V Endpoint
- **Route:** `POST /api/replicate/pixverse-v5-i2v/submit`
- **Middleware:**
  - `requireAuth` - Authentication required
  - `validatePixverseI2V` - Input validation
  - `makeCreditCost` - Credit cost calculation
  - `pixverseI2vSubmit` - Controller handler

---

### 3. Controllers
**File:** `src/controllers/replicateController.ts`

- **Function:** `pixverseT2vSubmit` (line 159)
  - Extracts user ID from request
  - Calls `replicateService.pixverseT2vSubmit`
  - Returns result

- **Function:** `pixverseI2vSubmit` (line 167)
  - Extracts user ID from request
  - Calls `replicateService.pixverseI2vSubmit`
  - Returns result

**Export:** Both exported via `Object.assign(replicateController, { pixverseT2vSubmit, pixverseI2vSubmit })` (line 175)

---

### 4. Input Validation
**File:** `src/middlewares/validators/replicate/validatePixverseT2V.ts`

- Validates `prompt` (required, 1-2000 chars)
- Validates `duration` (optional, must be 5 or 8)
- Validates `quality`/`resolution` (optional, must be 360p/540p/720p/1080p)
- Validates `aspect_ratio` (optional, must be 16:9/9:16/1:1)
- Validates `seed` (optional, integer)
- Validates `negative_prompt` (optional, string)
- **Default model:** `pixverseai/pixverse-v5` if not provided

**File:** `src/middlewares/validators/replicate/validatePixverseI2V.ts`

- Similar validation as T2V
- **Additional:** Requires `image` parameter
- **Default model:** `pixverseai/pixverse-v5` if not provided

---

### 5. Pricing System
**File:** `src/utils/pricing/pixversePricing.ts`

- **Pricing Version:** `pixverse-v1`
- **Function:** `computePixverseVideoCost`
  - Calculates credit cost based on:
    - Mode: T2V or I2V
    - Duration: 5s or 8s
    - Quality: 360p, 540p, 720p, 1080p
  - Looks up cost from `creditDistribution.ts`
  - Returns: `{ cost, pricingVersion, meta }`

- **Function:** `computePixverseCostFromSku`
  - Direct SKU-based cost lookup

---

### 6. Credit Distribution
**File:** `src/data/creditDistribution.ts`

**PixVerse 5 T2V SKUs (lines 1868-1991):**
- PixVerse 5 T2V 5s 360p
- PixVerse 5 T2V 5s 540p
- PixVerse 5 T2V 5s 720p
- PixVerse 5 T2V 5s 1080p
- PixVerse 5 T2V 8s 360p
- PixVerse 5 T2V 8s 540p
- PixVerse 5 T2V 8s 720p
- PixVerse 5 T2V 8s 1080p

**PixVerse 5 I2V SKUs (lines 1993-2113):**
- PixVerse 5 I2V 5s 360p
- PixVerse 5 I2V 5s 540p
- PixVerse 5 I2V 5s 720p
- PixVerse 5 I2V 5s 1080p
- PixVerse 5 I2V 8s 360p
- PixVerse 5 I2V 8s 540p
- PixVerse 5 I2V 8s 720p
- PixVerse 5 I2V 8s 1080p

---

### 7. Canvas Integration
**File:** `src/services/canvas/generateService.ts`

- **Model Mapping:** (line 418-419)
  ```typescript
  if (modelLower.includes('pixverse v5') || modelLower === 'pixverse v5' || modelLower.includes('pixverse')) {
    return { service: 'replicate', method: 'pixverseT2vSubmit', backendModel: 'pixverseai/pixverse-v5' };
  }
  ```

- **Parameter Handling:** (lines 565-575)
  - PixVerse uses "quality" instead of "resolution" for T2V
  - Ensures no image/frame parameters are passed for T2V
  - Maps resolution to quality parameter

---

### 8. Documentation
**File:** `VIDEO_GENERATION_CANVAS_INTEGRATION.md`

- Documents PixVerse v5 as a Replicate service model
- Notes: Uses "quality" parameter, supports 360p/540p/720p/1080p

**File:** `TECHNICAL_ARCHITECTURE_BACKEND.md`

- Documents API endpoints:
  - `POST /api/replicate/pixverse-v5-t2v/submit`
  - `POST /api/replicate/pixverse-v5-i2v/submit`

---

## Current Issue

### Problem
The model `pixverseai/pixverse-v5` is returning **404 Not Found** from Replicate API, indicating:
1. The model may have been removed from Replicate
2. The model name may have changed
3. The model may require a specific version hash instead of the model slug

### Recent Fixes Applied
1. ✅ **Input Cleaning:** Explicitly builds clean input object with only T2V parameters (no image/frame)
2. ✅ **Error Handling:** Improved error messages and logging for 404 errors
3. ✅ **Version Lookup:** Added fallback if version lookup fails

### Code Status
- ✅ All PixVerse v5 code is present and properly structured
- ✅ T2V and I2V implementations are complete
- ✅ Validation, pricing, and routing are all configured
- ⚠️ **Issue:** Model identifier `pixverseai/pixverse-v5` may be incorrect or the model may no longer exist on Replicate

---

## Recommendations

1. **Verify Model Name:** Check Replicate's website/API to confirm the correct model identifier for PixVerse v5
2. **Check Model Status:** Verify if `pixverseai/pixverse-v5` still exists on Replicate
3. **Alternative Model:** If the model was renamed, update the model identifier in:
   - `src/services/replicateService.ts` (lines 2591, 2782)
   - `src/middlewares/validators/replicate/validatePixverseT2V.ts` (line 22)
   - `src/middlewares/validators/replicate/validatePixverseI2V.ts` (line 23)
   - `src/services/canvas/generateService.ts` (line 419)

---

## Conclusion

**PixVerse v5 code is fully present and implemented** in the backend. The issue is not with the code implementation, but with the model identifier (`pixverseai/pixverse-v5`) that may no longer be valid on Replicate's platform.

