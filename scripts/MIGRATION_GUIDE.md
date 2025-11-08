# Image Optimization Migration Script

This script optimizes images from existing generations that were created before the image optimization system was implemented.

## Quick Start

```bash
# Navigate to the api-gateway-services directory
cd api-gateway-services-wildmind

# Run a dry-run first to see what would be optimized (recommended)
npm run migrate:optimize-images -- --dry-run

# Run the actual migration
npm run migrate:optimize-images

# Run with custom batch size and delay
npm run migrate:optimize-images -- --batch-size=5 --delay=3000
```

## Command Line Options

| Option | Default | Description |
|--------|---------|-------------|
| `--batch-size=N` | 10 | Number of generations to process per batch |
| `--delay=N` | 2000 | Delay between batches in milliseconds |
| `--dry-run` | false | Preview what would be optimized without making changes |
| `--generation-type=TYPE` | all | Filter by generation type (e.g., text-to-image) |
| `--start-date=YYYY-MM-DD` | none | Process only generations after this date |
| `--end-date=YYYY-MM-DD` | none | Process only generations before this date |

## Usage Examples

### 1. Dry Run (Recommended First Step)
```bash
npm run migrate:optimize-images -- --dry-run
```
This will show you what would be optimized without making any changes.

### 2. Basic Migration
```bash
npm run migrate:optimize-images
```
Processes all unoptimized generations with default settings (batch size: 10, delay: 2s).

### 3. Conservative Migration (Slower, Safer)
```bash
npm run migrate:optimize-images -- --batch-size=5 --delay=5000
```
Smaller batches with longer delays to reduce load on Firebase and storage.

### 4. Filter by Generation Type
```bash
npm run migrate:optimize-images -- --generation-type=text-to-image
```
Only optimize text-to-image generations.

### 5. Filter by Date Range
```bash
npm run migrate:optimize-images -- --start-date=2024-01-01 --end-date=2024-12-31
```
Only optimize generations from 2024.

### 6. Test on Recent Generations
```bash
npm run migrate:optimize-images -- --start-date=2024-11-01 --batch-size=3 --dry-run
```
Test the migration on just 3 recent generations without making changes.

## Output Example

```
🚀 Starting Image Optimization Migration

Configuration:
  - Batch Size: 10
  - Delay: 2000ms
  - Dry Run: NO

📦 Processing Batch #1...
  ✅ Successful: 7
  ⏭️  Skipped: 2
  ❌ Failed: 1

⏳ Waiting 2000ms before next batch...

📦 Processing Batch #2...
  ✅ Successful: 8
  ⏭️  Skipped: 2
  ❌ Failed: 0

✨ Migration Complete!

═══════════════════════════════════════
Total Time: 45.32s
Batches Processed: 5
Total Generations: 47
  ✅ Successful: 35
  ⏭️  Skipped: 10
  ❌ Failed: 2
═══════════════════════════════════════
```

## What Gets Optimized

For each unoptimized generation image, the script will:

1. ✅ Download the original image from the provider URL
2. ✅ Generate WebP version (quality 85, max 2048x2048)
3. ✅ Generate thumbnail (400x400, quality 75)
4. ✅ Generate blur placeholder (20x20, base64)
5. ✅ Upload all variants to Firebase Storage
6. ✅ Update Firestore with optimized URLs
7. ✅ Mark generation as optimized

## Skipped Generations

The script will skip generations that:
- Are already optimized (have `optimized: true` flag or webpUrl)
- Have no images
- Are not in "completed" status

## Error Handling

- **Failed downloads**: Logs error, continues to next generation
- **Failed uploads**: Logs error, continues to next generation
- **Failed Firestore updates**: Logs error, continues to next generation
- **Batch errors**: Logs error, stops migration to prevent data corruption

You can retry failed optimizations later using the admin API:
```bash
curl -X POST "http://localhost:8000/api/admin/retry-optimization/USER_ID/HISTORY_ID"
```

## Performance Considerations

### Recommended Settings

| Total Generations | Batch Size | Delay | Estimated Time |
|-------------------|------------|-------|----------------|
| < 100 | 10 | 2000ms | ~5-10 min |
| 100-1000 | 10 | 2000ms | ~30-60 min |
| 1000-5000 | 5 | 3000ms | ~2-4 hours |
| > 5000 | 5 | 5000ms | ~4-8 hours |

### Why Delays?

Delays between batches prevent:
- Overwhelming Firebase Storage with upload requests
- Rate limiting on external image providers
- High memory usage from concurrent processing
- Firebase quota exhaustion

### Monitoring

Watch for these log entries:
```
[Migration] [DRY RUN] Would optimize generation
[Migration] Optimized image 1/4
[ImageOptimization] Starting optimization for 1 images
[ImageOptimization] Image optimized successfully
[Migration] Failed to optimize generation
```

## Troubleshooting

### Script Fails Immediately

**Check:**
1. Environment variables are set (especially `FIREBASE_STORAGE_BUCKET`)
2. Firebase credentials are valid
3. Sharp library is installed correctly

**Fix:**
```bash
# Verify environment
cat .env | grep FIREBASE_STORAGE_BUCKET

# Reinstall Sharp
npm rebuild sharp

# Test Firebase connection
npm run dev
```

### High Failure Rate

**Common Causes:**
- Firebase Storage permissions insufficient
- Original image URLs expired or inaccessible
- Network connectivity issues
- Sharp library errors on specific image formats

**Solutions:**
1. Check Firebase Storage IAM permissions
2. Verify original URLs are still accessible
3. Retry failed generations after fixing permissions
4. Check logs for specific error patterns

### Script Stops Mid-Migration

**Recovery:**
- The script can be safely restarted
- Already optimized generations will be skipped
- Use `--start-date` to skip processed batches
- Check `lastDocId` in logs to resume from specific point

### Out of Memory

**Solutions:**
1. Reduce batch size: `--batch-size=3`
2. Increase delay: `--delay=5000`
3. Process in smaller date ranges
4. Restart Node.js process between batches

## Advanced Usage

### Resume from Specific Date

```bash
# First run processed up to March 15th, resume from there
npm run migrate:optimize-images -- --start-date=2024-03-16
```

### Process Specific Generation Types in Sequence

```bash
# Text-to-image first
npm run migrate:optimize-images -- --generation-type=text-to-image

# Then videos
npm run migrate:optimize-images -- --generation-type=text-to-video

# Then others
npm run migrate:optimize-images -- --generation-type=logo
```

### Night-time Migration (Low Traffic)

```bash
# Run with aggressive settings during off-peak hours
npm run migrate:optimize-images -- --batch-size=20 --delay=1000
```

## Verification

After migration completes:

### 1. Check Firestore
```javascript
// Query a few optimized generations
db.collection('users')
  .doc('USER_ID')
  .collection('generationHistory')
  .limit(5)
  .get()
  .then(snapshot => {
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      console.log('Images:', data.images);
      // Should have webpUrl, thumbnailUrl, blurDataUrl
    });
  });
```

### 2. Check Firebase Storage
```bash
# List optimized images
gsutil ls gs://your-project.appspot.com/users/USER_ID/generations/
```

### 3. Check Frontend
- Visit your app
- Open generation history
- Inspect network tab - should see WebP images loading
- Verify thumbnails are smaller files
- Check blur placeholders appear during loading

## Cost Estimation

**Firebase Storage:**
- Storage: ~500KB per generation (3 variants)
- Bandwidth: ~2MB per generation (initial download + upload)
- Operations: ~10 operations per generation

**Example:**
- 1000 generations × 500KB = ~500MB storage ($0.03/month)
- 1000 generations × 10 operations = 10,000 operations (free tier)

## Best Practices

1. ✅ **Always dry-run first** - Verify what will be processed
2. ✅ **Start small** - Test with `--batch-size=3` on recent generations
3. ✅ **Monitor logs** - Watch for patterns of failures
4. ✅ **Schedule during off-peak** - Reduce impact on live users
5. ✅ **Verify results** - Check a few generations after completion
6. ✅ **Keep originals** - Migration preserves original URLs
7. ✅ **Can be interrupted** - Safe to stop and restart anytime

## Support

If you encounter issues:

1. Check the output for specific error messages
2. Review logs: `grep "Migration" logs/app.log`
3. Verify environment configuration
4. Test with a single generation using admin API
5. Check Firebase Console for quota/permission issues

---

**Last Updated**: 2024-11-06
**Script Version**: 1.0.0
