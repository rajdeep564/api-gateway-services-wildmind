/**
 * Verification Script: Check if thumbnails are in correct paths
 * 
 * This script checks if optimized images are stored next to originals
 * 
 * Usage:
 *   npx ts-node scripts/verifyThumbnailPaths.ts <uid> <historyId>
 * 
 * Example:
 *   npx ts-node scripts/verifyThumbnailPaths.ts abc123 xyz789
 */

import 'dotenv/config';
import { adminDb } from '../src/config/firebaseAdmin';

async function verify() {
  const uid = process.argv[2];
  const historyId = process.argv[3];

  if (!uid || !historyId) {
    console.error('Usage: npx ts-node scripts/verifyThumbnailPaths.ts <uid> <historyId>');
    process.exit(1);
  }

  console.log(`\n🔍 Checking generation: ${uid}/${historyId}\n`);

  try {
    const docRef = adminDb
      .collection('generationHistory')
      .doc(uid)
      .collection('items')
      .doc(historyId);

    const doc = await docRef.get();

    if (!doc.exists) {
      console.error('❌ Document not found');
      process.exit(1);
    }

    const data = doc.data();
    const images = data?.images || [];

    console.log(`Found ${images.length} images\n`);

    images.forEach((img: any, idx: number) => {
      console.log(`Image ${idx + 1}:`);
      console.log(`  Original URL: ${img.url || 'N/A'}`);
      
      // Extract path from original URL
      const ZATA_PREFIX = 'https://idr01.zata.ai/devstoragev1/';
      if (img.url && img.url.startsWith(ZATA_PREFIX)) {
        const fullPath = img.url.substring(ZATA_PREFIX.length);
        const lastSlashIndex = fullPath.lastIndexOf('/');
        if (lastSlashIndex > 0) {
          const basePath = fullPath.substring(0, lastSlashIndex);
          console.log(`  Storage Path: ${basePath}`);
        }
      }
      
      console.log(`  Has avifUrl: ${img.avifUrl ? '✅' : '❌'}`);
      if (img.avifUrl) {
        console.log(`  AVIF URL: ${img.avifUrl}`);
      }
      
      console.log(`  Has thumbnailUrl: ${img.thumbnailUrl ? '✅' : '❌'}`);
      if (img.thumbnailUrl) {
        console.log(`  Thumbnail URL: ${img.thumbnailUrl}`);
      }
      
      console.log(`  Has blurDataUrl: ${img.blurDataUrl ? '✅' : '❌'}`);
      console.log(`  Optimized: ${img.optimized ? '✅ Yes' : '❌ No'}`);
      
      // Check if paths match
      if (img.url && img.thumbnailUrl) {
        const originalPath = img.url.substring(0, img.url.lastIndexOf('/'));
        const thumbnailPath = img.thumbnailUrl.substring(0, img.thumbnailUrl.lastIndexOf('/'));
        const pathsMatch = originalPath === thumbnailPath;
        console.log(`  Paths Match: ${pathsMatch ? '✅ Yes' : '❌ No'}`);
      }
      
      console.log('');
    });

    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

verify();
