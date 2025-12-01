import sharp from 'sharp';
import axios from 'axios';

/**
 * Frame metadata interface for storyboard builder
 */
export interface StoryboardFrame {
  buffer: Buffer;
  metadata: {
    character?: string;
    background?: string;
    objects?: string;
    lighting?: string;
    camera?: string;
    mood?: string;
    style?: string;
    environment?: string;
    [key: string]: string | undefined; // Allow additional metadata keys
  };
}

/**
 * Creates a horizontally stitched storyboard sheet from multiple frames
 * 
 * @param frames - Array of frames, where index 0 is always the master reference image
 * @returns PNG buffer of the stitched storyboard
 */
export async function createStoryboard(frames: StoryboardFrame[]): Promise<Buffer> {
  if (!frames || frames.length === 0) {
    throw new Error('Frames array cannot be empty');
  }

  const IMAGE_SIZE = 512;
  const METADATA_PANEL_PADDING = 20;
  const METADATA_LINE_HEIGHT = 35;
  const METADATA_FONT_SIZE = 26;
  const METADATA_BG_COLOR = '#111111';
  const METADATA_TEXT_COLOR = '#FFFFFF';

  // Resize all images to 512x512
  const resizedImages: Buffer[] = [];
  for (const frame of frames) {
    const resized = await sharp(frame.buffer)
      .resize(IMAGE_SIZE, IMAGE_SIZE, {
        fit: 'fill',
        kernel: 'lanczos3',
      })
      .png()
      .toBuffer();
    resizedImages.push(resized);
  }

  // Calculate metadata panel heights for each frame
  const metadataHeights: number[] = [];
  for (const frame of frames) {
    const metadataKeys = Object.keys(frame.metadata).filter(
      key => frame.metadata[key] && frame.metadata[key]!.trim() !== ''
    );
    const lineCount = metadataKeys.length;
    const panelHeight = METADATA_PANEL_PADDING * 2 + (lineCount * METADATA_LINE_HEIGHT);
    metadataHeights.push(panelHeight);
  }

  // Calculate total dimensions
  const totalWidth = frames.length * IMAGE_SIZE;
  const maxMetadataHeight = Math.max(...metadataHeights);
  const totalHeight = IMAGE_SIZE + maxMetadataHeight;

  // Create base canvas
  const canvas = sharp({
    create: {
      width: totalWidth,
      height: totalHeight,
      channels: 3,
      background: { r: 17, g: 17, b: 17 }, // #111 background
    },
  });

  // Composite images and metadata panels
  const composites: sharp.OverlayOptions[] = [];

  // Place images horizontally
  for (let i = 0; i < resizedImages.length; i++) {
    composites.push({
      input: resizedImages[i],
      left: i * IMAGE_SIZE,
      top: 0,
    });
  }

  // Create and place metadata panels
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const metadataKeys = Object.keys(frame.metadata).filter(
      key => frame.metadata[key] && frame.metadata[key]!.trim() !== ''
    );

    if (metadataKeys.length > 0) {
      // Build SVG for metadata panel
      const panelHeight = metadataHeights[i];
      const panelWidth = IMAGE_SIZE;

      const metadataLines = metadataKeys.map((key, idx) => {
        const value = frame.metadata[key] || '';
        const displayKey = key.toUpperCase().replace(/_/g, ' ');
        return `<text x="${METADATA_PANEL_PADDING}" y="${METADATA_PANEL_PADDING + (idx + 1) * METADATA_LINE_HEIGHT}" 
                     font-family="Arial, sans-serif" 
                     font-size="${METADATA_FONT_SIZE}" 
                     fill="${METADATA_TEXT_COLOR}">
                   ${displayKey}: ${escapeXml(value)}
                 </text>`;
      }).join('\n');

      const svg = `
        <svg width="${panelWidth}" height="${panelHeight}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${panelWidth}" height="${panelHeight}" fill="${METADATA_BG_COLOR}"/>
          ${metadataLines}
        </svg>
      `;

      const metadataPanel = Buffer.from(svg);
      const metadataBuffer = await sharp(metadataPanel)
        .png()
        .toBuffer();

      composites.push({
        input: metadataBuffer,
        left: i * IMAGE_SIZE,
        top: IMAGE_SIZE,
      });
    }
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

/**
 * Downloads an image from URL and returns as Buffer
 */
export async function downloadImageAsBuffer(imageUrl: string): Promise<Buffer> {
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });
    return Buffer.from(response.data);
  } catch (error) {
    throw new Error(`Failed to download image from ${imageUrl}: ${error}`);
  }
}

