# Storage Validation Integration Guide

## Overview

This guide explains how to integrate storage+credit validation into generation services to prevent storage overflow.

## Pattern: Before vs After

### ❌ Old Pattern (Debit After Generation)
```typescript
// Generation completes first
const output = await runGeneration(...);

// Then debit credits
await creditsRepository.writeDebitIfAbsent(uid, historyId, cost, 'service.generate');
```

**Problem**: If user is at storage limit, generation succeeds but can't be stored, wasting credits.

### ✅ New Pattern (Validate Before Generation)
```typescript
import { validateGenerationRequest, estimateFileSize } from '../utils/validationHelpers';

// 1. Validate BEFORE generation
const validation = await validateGenerationRequest(
  uid,
  creditCost,
  estimateFileSize('video', { duration: 10, quality: 'high' })
);

if (!validation.valid) {
  // Block generation and return error
  throw new ApiError(validation.reason || 'Validation failed', validation.code === 'STORAGE_QUOTA_EXCEEDED' ? 402 : 400);
}

// 2. Run generation
const output = await runGeneration(...);

// 3. Debit credits after successful generation
await creditsRepository.writeDebitIfAbsent(uid, historyId, cost, 'service.generate');
```

---

## Integration Steps

### Step 1: Import Validation Helper

```typescript
import { validateGenerationRequest, estimateFileSize } from '../utils/validationHelpers';
```

### Step 2: Add Validation Before Generation

**For Image Generation**:
```typescript
// Estimate: 1024x1024 high-quality JPEG ≈ 512KB
const validation = await validateGenerationRequest(
  uid,
  creditCost,
  estimateFileSize('image', { width: 1024, height: 1024, quality: 'high' })
);

if (!validation.valid) {
  await generationHistoryRepository.update(uid, historyId, {
    status: 'failed',
    error: validation.reason,
  });
  throw new ApiError(validation.reason || 'Validation failed', validation.code === 'STORAGE_QUOTA_EXCEEDED' ? 402 : 400);
}
```

**For Video Generation**:
```typescript
// Estimate: 10s video at 5Mbps ≈ 6.25MB
const validation = await validateGenerationRequest(
  uid,
  creditCost,
  estimateFileSize('video', { duration: 10, quality: 'medium' })
);

if (!validation.valid) {
  await generationHistoryRepository.update(uid, historyId, {
    status: 'failed',
    error: validation.reason,
  });
  throw new ApiError(validation.reason || 'Validation failed', validation.code === 'STORAGE_QUOTA_EXCEEDED' ? 402 : 400);
}
```

### Step 3: Handle Error on Frontend

The validation will throw `ApiError` with:
- **Status 402** for `STORAGE_QUOTA_EXCEEDED` → Show StorageUpgradeModal
- **Status 400** for `INSUFFICIENT_CREDITS` → Show Credit Purchase Modal

---

## Services to Update

| Service | Location | Priority |
|---------|----------|----------|
| replicateService | `/services/replicateService.ts` | 🔴 High |
| falService | `/services/falService.ts` | 🔴 High |
| runwayService | `/services/runwayService.ts` | 🔴 High |
| minimaxService | `/services/minimaxService.ts` | 🔴 High |
| wildmindImageService | `/services/wildmindImageService.ts` | 🟡 Medium |
| Workflow Services | `/services/workflows/**/*.ts` | 🟢 Low |

---

## Example: wanT2vSubmit Integration

```typescript
export async function wanT2vSubmit(uid: string, body: any): Promise<SubmitReturn> {
  if (!body?.prompt) throw new ApiError("prompt is required", 400);
  
  const replicate = ensureReplicate();
  const isFast = await resolveWanModelFast(body);
  const modelBase = isFast ? "wan-video/wan-2.5-t2v-fast" : "wan-video/wan-2.5-t2v";
  const duration = ((s: any): number => {
    const str = String(s ?? "5").toLowerCase();
    const m = str.match(/(5|10)/);
    return m ? Number(m[1]) : 5;
  })(body.duration);
  
  // ✅ NEW: Validate before creating prediction
  const { cost } = await computeWanVideoCost({
    body: { mode: 't2v', duration, resolution: body.resolution || '720p' }
  } as any);
  
  const validation = await validateGenerationRequest(
    uid,
    cost,
    estimateFileSize('video', { duration, quality: 'medium' })
  );
  
  if (!validation.valid) {
    throw new ApiError(
      validation.reason || 'Validation failed',
      validation.code === 'STORAGE_QUOTA_EXCEEDED' ? 402 : 400
    );
  }
  
  // Continue with generation...
  const { historyId } = await generationHistoryRepository.create(...);
  
  // ... rest of generation logic
}
```

---

## Testing

### Manual Testing

1. **Test Storage Full Block**:
   - Set user storage to 99% of quota
   - Attempt generation
   - Verify 402 error with storage message
   - Verify no credits deducted

2. **Test Credits Low Block**:
   - Set user credits to 10 (< cost)
   - Attempt generation
   - Verify 400 error with credits message

3. **Test Successful Generation**:
   - User with sufficient credits and storage
   - Verify generation completes
   - Verify credits debited after completion

---

## Notes

- **Estimation Accuracy**: File size estimates are conservative. Better to overestimate than underestimate.
- **Transaction Safety**: Credit debit happens AFTER generation success, preventing loss of credits on failed generations.
- **Error Codes**: 
  - `402 Payment Required` = Upgrade needed (storage or plan)
  - `400 Bad Request` = Insufficient credits
  - `404 Not Found` = User not found
