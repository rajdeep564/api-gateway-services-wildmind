import sharp from 'sharp';
import axios from 'axios';

/**
 * Creates a stitched reference image from multiple character/background/prop images
 * Each image is labeled with its type and name
 * 
 * @param images - Array of images with labels
 * @returns PNG buffer of the stitched reference image
 */
export interface ReferenceImageItem {
  url: string;
  label: string; // e.g., "Character: Aryan", "Background: Restaurant", "Prop: Rose"
  type: 'character' | 'background' | 'prop';
}

export async function createReferenceImage(images: ReferenceImageItem[]): Promise<Buffer> {
  if (!images || images.length === 0) {
    throw new Error('Images array cannot be empty');
  }

  const IMAGE_SIZE = 512;
  const LABEL_HEIGHT = 60;
  const LABEL_PADDING = 10;
  const LABEL_FONT_SIZE = 32;
  const LABEL_BG_COLOR = '#1a1a1a';
  const LABEL_TEXT_COLOR = '#FFFFFF';
  const SPACING = 20; // Space between image blocks

  // Download and resize all images
  const processedImages: Array<{ buffer: Buffer; label: string }> = [];
  
  for (const img of images) {
    try {
      // Download image
      const response = await axios.get(img.url, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });
      const imageBuffer = Buffer.from(response.data);

      // Resize to 512x512
      const resized = await sharp(imageBuffer)
        .resize(IMAGE_SIZE, IMAGE_SIZE, {
          fit: 'fill',
          kernel: 'lanczos3',
        })
        .png()
        .toBuffer();

      processedImages.push({
        buffer: resized,
        label: img.label,
      });
    } catch (error) {
      console.warn(`[createReferenceImage] Failed to download image ${img.url}:`, error);
      // Skip failed images
    }
  }

  if (processedImages.length === 0) {
    throw new Error('No images could be processed');
  }

  // Calculate dimensions
  const totalWidth = processedImages.length * IMAGE_SIZE + (processedImages.length - 1) * SPACING;
  const blockHeight = IMAGE_SIZE + LABEL_HEIGHT;
  const totalHeight = blockHeight;

  // Create base canvas
  const canvas = sharp({
    create: {
      width: totalWidth,
      height: totalHeight,
      channels: 3,
      background: { r: 17, g: 17, b: 17 }, // #111 background
    },
  });

  // Composite images and labels
  const composites: sharp.OverlayOptions[] = [];

  // Place images and labels horizontally
  for (let i = 0; i < processedImages.length; i++) {
    const x = i * (IMAGE_SIZE + SPACING);

    // Place image
    composites.push({
      input: processedImages[i].buffer,
      left: x,
      top: 0,
    });

    // Create label SVG
    const labelSvg = `
      <svg width="${IMAGE_SIZE}" height="${LABEL_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${IMAGE_SIZE}" height="${LABEL_HEIGHT}" fill="${LABEL_BG_COLOR}"/>
        <text x="${IMAGE_SIZE / 2}" y="${LABEL_HEIGHT / 2 + LABEL_PADDING}" 
              font-family="Arial, sans-serif" 
              font-size="${LABEL_FONT_SIZE}" 
              fill="${LABEL_TEXT_COLOR}"
              text-anchor="middle"
              dominant-baseline="middle">
          ${escapeXml(processedImages[i].label)}
        </text>
      </svg>
    `;

    const labelBuffer = Buffer.from(labelSvg);
    const labelImage = await sharp(labelBuffer).png().toBuffer();

    composites.push({
      input: labelImage,
      left: x,
      top: IMAGE_SIZE,
    });
  }

  // Composite everything together
  const finalBuffer = await canvas
    .composite(composites)
    .png()
    .toBuffer();

  return finalBuffer;
}

/**
 * Escapes XML special characters for safe SVG text rendering
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

