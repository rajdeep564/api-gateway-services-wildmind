// Load environment variables first
import 'dotenv/config';

import { adminDb } from '../src/config/firebaseAdmin';

async function findOptimizedDocument() {
  try {
    console.log('🔍 Searching for an optimized document...\n');
    
    // Use collectionGroup to query all 'items' subcollections across all users
    const itemsSnapshot = await adminDb
      .collectionGroup('items')
      .where('status', '==', 'completed')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    
    console.log(`Found ${itemsSnapshot.size} completed generations to check\n`);
    
    let documentsChecked = 0;
    let optimizedFound = 0;
    
    // Check each document for optimized images
    for (const doc of itemsSnapshot.docs) {
      const data = doc.data();
      documentsChecked++;
      
      // Extract uid from document path
      // Path format: generationHistory/{uid}/items/{historyId}
      const pathParts = doc.ref.path.split('/');
      const uid = pathParts[1];
      const historyId = doc.id;
      
      // Check if images array has optimized field
      if (data.images && Array.isArray(data.images) && data.images.length > 0) {
        const firstImage = data.images[0];
        if (typeof firstImage === 'object' && firstImage.avifUrl) {
          optimizedFound++;
          console.log(`\n✅ Found optimized document #${optimizedFound}!`);
          console.log(`UID: ${uid}`);
          console.log(`History ID: ${historyId}`);
          console.log(`\nOptimized Image Data:`);
          console.log(`- Original URL: ${firstImage.url}`);
          console.log(`- AVIF URL: ${firstImage.avifUrl}`);
          console.log(`- Thumbnail URL: ${firstImage.thumbnailUrl}`);
          
          // Extract paths
          const originalMatch = firstImage.url.match(/https?:\/\/[^\/]+\/(.+)/);
          const avifMatch = firstImage.avifUrl.match(/https?:\/\/[^\/]+\/(.+)/);
          const thumbMatch = firstImage.thumbnailUrl.match(/https?:\/\/[^\/]+\/(.+)/);
          
          if (originalMatch && avifMatch && thumbMatch) {
            const originalPath = decodeURIComponent(originalMatch[1]);
            const avifPath = decodeURIComponent(avifMatch[1]);
            const thumbPath = decodeURIComponent(thumbMatch[1]);
            
            console.log(`\n📁 Storage Paths:`);
            console.log(`Original:  ${originalPath}`);
            console.log(`AVIF:      ${avifPath}`);
            console.log(`Thumbnail: ${thumbPath}`);
            
            // Check if they're in the same directory
            const originalDir = originalPath.substring(0, originalPath.lastIndexOf('/'));
            const avifDir = avifPath.substring(0, avifPath.lastIndexOf('/'));
            const thumbDir = thumbPath.substring(0, thumbPath.lastIndexOf('/'));
            
            if (originalDir === avifDir && avifDir === thumbDir) {
              console.log(`\n✅ SUCCESS: All files are in the same directory!`);
              console.log(`Directory: ${originalDir}`);
            } else {
              console.log(`\n❌ MISMATCH: Files are in different directories!`);
              console.log(`Original Dir:  ${originalDir}`);
              console.log(`AVIF Dir:      ${avifDir}`);
              console.log(`Thumbnail Dir: ${thumbDir}`);
            }
          }
          
          console.log(`\n🔍 Verify this document with:`);
          console.log(`npx ts-node scripts/verifyThumbnailPaths.ts ${uid} ${historyId}`);
          
          if (optimizedFound >= 3) {
            console.log(`\n✅ Found ${optimizedFound} optimized documents. That's enough to verify!`);
            process.exit(0);
          }
        }
      }
    }
    
    console.log(`\n📊 Search Summary:`);
    console.log(`- Documents checked: ${documentsChecked}`);
    console.log(`- Optimized found: ${optimizedFound}`);
    
    if (optimizedFound === 0) {
      console.log('\n❌ No optimized documents found');
      process.exit(1);
    } else {
      process.exit(0);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

findOptimizedDocument();
