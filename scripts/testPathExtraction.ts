/**
 * Test script to verify path extraction logic
 */

function extractStoragePathFromUrl(imageUrl: string): { basePath: string; filename: string } {
  try {
    const ZATA_PREFIX = 'https://idr01.zata.ai/devstoragev1/';
    if (imageUrl.startsWith(ZATA_PREFIX)) {
      // Extract the full path from URL
      const fullPath = imageUrl.substring(ZATA_PREFIX.length);
      // Get directory and filename
      const lastSlashIndex = fullPath.lastIndexOf('/');
      if (lastSlashIndex > 0) {
        const basePath = fullPath.substring(0, lastSlashIndex);
        const originalFilename = fullPath.substring(lastSlashIndex + 1);
        // Remove extension(s) to get base filename
        const filename = originalFilename.replace(/\.[^.]+$/, '').replace(/\.[^.]+$/, '');
        return { basePath, filename };
      }
    }
  } catch (error) {
    console.warn('[extractStoragePathFromUrl] Failed to extract path:', error);
  }
  
  // Return empty strings if extraction failed
  return { basePath: '', filename: '' };
}

// Test cases
const testUrls = [
  'https://idr01.zata.ai/devstoragev1/users/rajdeop/image/Pz6cAbp7Oo3s1rol2qlP/image-1.png.png',
  'https://idr01.zata.ai/devstoragev1/users/rajdeop/image/ABC123/photo.jpg',
  'https://idr01.zata.ai/devstoragev1/users/testuser/video/XYZ789/video-1.mp4',
  'https://idr01.zata.ai/devstoragev1/generations/uid123/gen456/output.png',
];

console.log('=== Path Extraction Test ===\n');

testUrls.forEach((url, index) => {
  const { basePath, filename } = extractStoragePathFromUrl(url);
  
  console.log(`Test ${index + 1}:`);
  console.log(`  Original URL: ${url}`);
  console.log(`  Extracted basePath: ${basePath}`);
  console.log(`  Extracted filename: ${filename}`);
  console.log(`  Expected thumbnail: ${basePath}/${filename}_thumb.webp`);
  console.log(`  Expected optimized: ${basePath}/${filename}_optimized.webp`);
  console.log('');
});

console.log('=== Verification ===');
console.log('Expected behavior:');
console.log('- Original images should remain in their original location');
console.log('- Optimized variants should be stored NEXT TO the original image');
console.log('- Example: users/rajdeop/image/Pz6cAbp7Oo3s1rol2qlP/image-1.png.png');
console.log('  → Thumbnail: users/rajdeop/image/Pz6cAbp7Oo3s1rol2qlP/image-1_thumb.webp');
console.log('  → Optimized: users/rajdeop/image/Pz6cAbp7Oo3s1rol2qlP/image-1_optimized.webp');
