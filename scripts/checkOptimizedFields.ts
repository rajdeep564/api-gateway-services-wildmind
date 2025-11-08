/**
 * Check if specific generation has optimized fields
 * 
 * Usage:
 *   npx ts-node scripts/checkOptimizedFields.ts <uid> <historyId>
 * 
 * Example:
 *   npx ts-node scripts/checkOptimizedFields.ts abc123 xyz789
 */

import 'dotenv/config';
import { adminDb } from '../src/config/firebaseAdmin';

async function checkFields() {
  const [uid, historyId] = process.argv.slice(2);

  if (!uid || !historyId) {
    console.error('Usage: npx ts-node scripts/checkOptimizedFields.ts <uid> <historyId>');
    process.exit(1);
  }

  console.log(`\nChecking generation: ${historyId} for user: ${uid}\n`);

  try {
    // Check generationHistory collection
    const historyRef = adminDb
      .collection('generationHistory')
      .doc(uid)
      .collection('items')
      .doc(historyId);

    const historyDoc = await historyRef.get();

    if (!historyDoc.exists) {
      console.log('❌ Document not found in generationHistory collection');
      process.exit(1);
    }

    const historyData = historyDoc.data();
    console.log('✅ Found in generationHistory collection\n');
    console.log('Document data:');
    console.log(JSON.stringify(historyData, null, 2));

    // Check if images have optimized fields
    if (historyData?.images && Array.isArray(historyData.images)) {
      console.log(`\n📸 Images (${historyData.images.length} total):\n`);
      
      historyData.images.forEach((img: any, idx: number) => {
        console.log(`Image ${idx}:`);
        console.log(`  - url: ${img.url ? '✅' : '❌'}`);
        console.log(`  - thumbnailUrl: ${img.thumbnailUrl ? '✅ ' + img.thumbnailUrl : '❌ NOT FOUND'}`);
        console.log(`  - webpUrl: ${img.webpUrl ? '✅ ' + img.webpUrl : '❌ NOT FOUND'}`);
        console.log(`  - blurDataUrl: ${img.blurDataUrl ? '✅ (base64)' : '❌ NOT FOUND'}`);
        console.log(`  - optimized: ${img.optimized ? '✅ true' : '❌ false/missing'}`);
        console.log('');
      });
    } else {
      console.log('\n❌ No images found in document');
    }

    // Check mirror collection
    console.log('\n---\nChecking mirror collection (generations)...\n');
    
    const mirrorRef = adminDb.collection('generations').doc(historyId);
    const mirrorDoc = await mirrorRef.get();

    if (!mirrorDoc.exists) {
      console.log('❌ Document not found in generations (mirror) collection');
    } else {
      const mirrorData = mirrorDoc.data();
      console.log('✅ Found in generations (mirror) collection\n');
      
      if (mirrorData?.images && Array.isArray(mirrorData.images)) {
        console.log(`📸 Mirror Images (${mirrorData.images.length} total):\n`);
        
        mirrorData.images.forEach((img: any, idx: number) => {
          console.log(`Image ${idx}:`);
          console.log(`  - url: ${img.url ? '✅' : '❌'}`);
          console.log(`  - thumbnailUrl: ${img.thumbnailUrl ? '✅ ' + img.thumbnailUrl : '❌ NOT FOUND'}`);
          console.log(`  - webpUrl: ${img.webpUrl ? '✅ ' + img.webpUrl : '❌ NOT FOUND'}`);
          console.log(`  - blurDataUrl: ${img.blurDataUrl ? '✅ (base64)' : '❌ NOT FOUND'}`);
          console.log(`  - optimized: ${img.optimized ? '✅ true' : '❌ false/missing'}`);
          console.log('');
        });
      } else {
        console.log('❌ No images found in mirror document');
      }
    }

    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

checkFields();
