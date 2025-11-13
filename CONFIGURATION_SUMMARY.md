# Configuration Summary

## ✅ Your Setup is Complete!

### 1. Firebase Authentication (Firestore Only)

**Environment Variable Decoding:**
```typescript
// src/config/firebaseAdmin.ts
const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
if (b64) {
  const decoded = Buffer.from(b64, 'base64').toString('utf8');
  const serviceAccount = JSON.parse(decoded);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
```

**Status:** ✅ Configured in `.env` file
- Uses `FIREBASE_SERVICE_ACCOUNT_B64` with base64-encoded service account JSON
- Firebase is used **ONLY for Firestore** (database access)
- **NOT used for file storage** (that's Zata's job)

---

### 2. Zata Storage Configuration (S3-Compatible)

**Environment Variables (from `.env`):**
```properties
ZATA_ENDPOINT=https://idr01.zata.ai
ZATA_BUCKET=devstoragev1
ZATA_ACCESS_KEY_ID=H9QQ9Z3YR1J4GTUHA30P
ZATA_SECRET_ACCESS_KEY=HOdlcbPZkhBYGQkc5xmIYtp700NlAovhN78Jus3i
```

**Configuration Flow:**

1. **`src/config/env.ts`** - Loads environment variables:
   ```typescript
   zataEndpoint: process.env.ZATA_ENDPOINT || 'https://idr01.zata.ai'
   zataBucket: process.env.ZATA_BUCKET || 'devstoragev1'
   zataAccessKeyId: process.env.ZATA_ACCESS_KEY_ID
   zataSecretAccessKey: process.env.ZATA_SECRET_ACCESS_KEY
   zataRegion: 'us-east-1' (S3-compatible default)
   zataForcePathStyle: true
   ```

2. **`src/utils/storage/zataClient.ts`** - Creates S3 client:
   ```typescript
   export const s3 = new S3Client({
     region: ZATA_REGION,
     endpoint: ZATA_ENDPOINT,
     forcePathStyle: ZATA_FORCE_PATH_STYLE,
     credentials: {
       accessKeyId: ZATA_ACCESS_KEY_ID,
       secretAccessKey: ZATA_SECRET_ACCESS_KEY,
     },
   });
   
   export function makeZataPublicUrl(key: string): string {
     return `${ZATA_ENDPOINT}/${ZATA_BUCKET}/${encodeURI(key)}`;
   }
   ```

3. **`src/utils/storage/zataUpload.ts`** - Upload functions:
   ```typescript
   // Upload buffer to Zata Storage
   export async function uploadBufferToZata(
     key: string,
     buffer: Buffer,
     contentType: string
   ): Promise<{ key: string; publicUrl: string; etag?: string }> {
     const cmd = new PutObjectCommand({
       Bucket: ZATA_BUCKET,
       Key: key,
       ContentType: contentType,
       Body: buffer,
     });
     const out = await s3.send(cmd);
     const publicUrl = makeZataPublicUrl(key);
     return { key, publicUrl, etag: out.ETag };
   }
   
   // Download from URL and upload to Zata
   export async function uploadFromUrlToZata(params: {
     sourceUrl: string;
     keyPrefix: string;
     fileName?: string;
   }): Promise<{ key: string; publicUrl: string; etag?: string }> {
     // Downloads the file, then uploads to Zata
   }
   
   // Upload data URI (base64) to Zata
   export async function uploadDataUriToZata(params: {
     dataUri: string;
     keyPrefix: string;
     fileName?: string;
   }): Promise<{ key: string; publicUrl: string; etag?: string }> {
     // Decodes base64 and uploads to Zata
   }
   ```

**Status:** ✅ Fully configured and working
- Used by `minimaxService.ts`, `runwayService.ts`, and now `imageOptimizationService.ts`
- All file uploads go to Zata S3-compatible storage
- Public URLs: `https://idr01.zata.ai/devstoragev1/{key}`

---

### 3. Image Optimization Service

**Integration:** `src/services/imageOptimizationService.ts`

```typescript
import { uploadBufferToZata } from '../utils/storage/zataUpload';

// Generates optimized variants and uploads to Zata Storage
async function uploadToStorage(
  path: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const { publicUrl } = await uploadBufferToZata(path, buffer, contentType);
  logger.info({ path, publicUrl }, 'Uploaded optimized image to Zata Storage');
  return publicUrl;
}
```

**Storage Structure:**
```
users/{uid}/generations/{historyId}/
  ├── image_0.jpg          (original)
  ├── image_0.webp         (optimized WebP)
  ├── image_0_thumb.webp   (thumbnail 400x400)
  └── (blurDataUrl stored in Firestore, not uploaded)
```

**Optimization Specs:**
- **WebP:** Quality 85, max 2048x2048, effort 4
- **Thumbnail:** 400x400, quality 75, cover fit
- **Blur Placeholder:** 20x20, blur 5, base64-encoded inline
- **AVIF:** Optional, quality 80, effort 4

**Status:** ✅ Configured for Zata Storage
- Background processing in `generationHistoryService.markGenerationCompleted()`
- All optimized images upload to Zata bucket
- Returns public Zata URLs

---

### 4. Migration Script

**Script:** `scripts/migrateImageOptimization.ts`

**Usage:**
```bash
# Direct execution (recommended)
npx ts-node scripts/migrateImageOptimization.ts --dry-run --batch-size=5

# Or via npm (arguments don't parse correctly)
npm run migrate:optimize-images
```

**Options:**
- `--dry-run` - Preview without making changes
- `--batch-size=N` - Process N generations per batch (default: 10)
- `--delay=MS` - Wait MS milliseconds between batches (default: 2000)
- `--generation-type=TYPE` - Filter by type (e.g., text-to-image)
- `--start-date=YYYY-MM-DD` - Process only after this date
- `--end-date=YYYY-MM-DD` - Process only before this date

**What it does:**
1. Queries Firestore `generationHistory` collection group
2. Finds completed generations with unoptimized images
3. Downloads original images
4. Generates WebP, thumbnail, blur variants
5. Uploads all variants to Zata Storage
6. Updates Firestore with new URLs

**Status:** ✅ Script ready, needs Firestore indexes

---

### 5. Firestore Indexes Required

**Updated `firebase.indexes.json`:**

```json
{
  "indexes": [
    // ... existing items indexes ...
    {
      "collectionGroup": "generationHistory",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "generationHistory",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "generationType", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
  ]
}
```

**Deploy Indexes:**
```bash
firebase deploy --only firestore:indexes
```

**Or manually create via Firebase Console:**
- Click the error URL when running the migration script
- It will auto-create the needed index

**Status:** ⏳ Indexes defined, need to be deployed

---

## Quick Start Guide

### 1. Deploy Firestore Indexes

```bash
cd api-gateway-services-wildmind
firebase deploy --only firestore:indexes
```

Wait 5-10 minutes for indexes to build.

### 2. Test Migration (Dry Run)

```bash
npx ts-node scripts/migrateImageOptimization.ts --dry-run --batch-size=3
```

This will show what would be optimized without making changes.

### 3. Run Full Migration

```bash
npx ts-node scripts/migrateImageOptimization.ts --batch-size=10
```

This will:
- Process 10 generations per batch
- Wait 2 seconds between batches
- Upload optimized images to Zata Storage
- Update Firestore with new URLs

### 4. Monitor Progress

The script will show:
- ✅ Successful optimizations
- ⏭️ Skipped (already optimized)
- ❌ Failed (with error details)

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│                    WildMind AI Backend                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐        ┌──────────────┐                 │
│  │   Firebase   │        │ Zata Storage │                 │
│  │  (Firestore) │        │ (S3-compat)  │                 │
│  └──────────────┘        └──────────────┘                 │
│         │                        │                          │
│         │ Database access        │ File storage             │
│         │                        │                          │
│  ┌──────▼────────────────────────▼─────────────────────┐  │
│  │          generationHistoryService                    │  │
│  │  - Manages generation lifecycle                      │  │
│  │  - Triggers image optimization (background)          │  │
│  └──────────────────────────────────────────────────────┘  │
│                        │                                    │
│                        ▼                                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │       imageOptimizationService                       │  │
│  │  - Generates WebP/AVIF/thumbnail/blur variants       │  │
│  │  - Uploads to Zata via uploadBufferToZata()          │  │
│  │  - Returns public Zata URLs                          │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘

Storage URLs:
https://idr01.zata.ai/devstoragev1/users/{uid}/generations/{id}/image_0.webp
```

---

## Next Steps

1. **Deploy Firestore Indexes** (required for migration)
   ```bash
   firebase deploy --only firestore:indexes
   ```

2. **Test with Dry Run** (safe to run anytime)
   ```bash
   npx ts-node scripts/migrateImageOptimization.ts --dry-run --batch-size=3
   ```

3. **Run Migration** (when ready)
   ```bash
   npx ts-node scripts/migrateImageOptimization.ts --batch-size=10
   ```

4. **Update Frontend** (use OptimizedImage component)
   - Replace `<img>` tags with `<OptimizedImage>` component
   - Already created in `wild/src/components/media/OptimizedImage.tsx`

5. **Monitor Results**
   - Check Zata Storage for .webp files
   - Check Firestore for webpUrl, thumbnailUrl, blurDataUrl fields
   - Verify smaller file sizes and faster loading

---

## Troubleshooting

### "Unable to detect a Project Id"
- ✅ Fixed by adding `import 'dotenv/config'` to migration script
- Ensure `.env` file has `FIREBASE_SERVICE_ACCOUNT_B64`

### "The query requires an index"
- ✅ Fixed by adding indexes to `firebase.indexes.json`
- Deploy with: `firebase deploy --only firestore:indexes`
- Or click the error URL to auto-create

### "No generations found"
- Check if you have data in `generationHistory` collection
- Try without filters: `npx ts-node scripts/migrateImageOptimization.ts --dry-run`

### Arguments not parsed correctly
- Use `npx ts-node` directly instead of `npm run`
- Example: `npx ts-node scripts/migrateImageOptimization.ts --dry-run`

---

## Summary

✅ **Firebase:** Configured for Firestore (database) access only  
✅ **Zata Storage:** Configured for all file storage (images, videos, etc.)  
✅ **Image Optimization:** Integrated with Zata Storage  
✅ **Migration Script:** Ready with dotenv loading  
⏳ **Firestore Indexes:** Defined, need to be deployed  

**Your system is ready!** Deploy the indexes and run the migration.
