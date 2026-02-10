import { generateForCanvas } from '../../canvas/generateService';
import { ApiError } from '../../../utils/errorHandler';

export interface StoryboardRequest {
  image?: string;
  characterImages: { url: string; name: string }[];
  storyScript: string;
  storyboardTitle?: string;
  textVisibility?: 'With Text' | 'Without Text';
  visualStyle?: string;
  screenOrientation?: string;
  isPublic?: boolean;
}

/**
 * Splits a script into chunks of max 6 scenes/paragraphs each
 */
function paginateScript(script: string): string[] {
  // Split by double newlines or just newlines to find discrete "scenes"
  // Assuming users separate scenes by newlines
  const scenes = script.split(/\n+/).filter(line => line.trim().length > 0);

  const chunks: string[] = [];
  const CHUNK_SIZE = 6;

  for (let i = 0; i < scenes.length; i += CHUNK_SIZE) {
    const chunkScenes = scenes.slice(i, i + CHUNK_SIZE);
    chunks.push(chunkScenes.join('\n\n'));
  }

  return chunks.length > 0 ? chunks : [script];
}

export async function generateStoryboard(uid: string, request: StoryboardRequest) {
  try {
    const {
      characterImages,
      storyScript,
      storyboardTitle,
      textVisibility,
      visualStyle,
      screenOrientation
    } = request;

    if (!characterImages || characterImages.length === 0) {
      throw new ApiError('Character images are required', 400);
    }

    if (!storyScript) {
      throw new ApiError('Story script is required', 400);
    }

    // Format character descriptions for the prompt
    const characterDescriptions = characterImages
      .map((char, index) => {
        const name = char.name?.trim() ? char.name : `Character ${index + 1}`;
        return `${name}`;
      })
      .join(', ');

    // Split script into pages
    const scriptPages = paginateScript(storyScript);
    console.log(`[generateStoryboard] Split script into ${scriptPages.length} pages`);

    // Generate for each page in parallel
    const promiseGenerations = scriptPages.map(async (pageScript, pageIndex) => {
      // Construct a prompt that includes all details
      const prompt = `Create a storyboard PAGE ${pageIndex + 1} titled "${storyboardTitle || 'Untitled'}" with specific scenes based on the script segment: "${pageScript}".
      Style: ${visualStyle || 'Cinematic'}.
      Characters: ${characterDescriptions} (images provided).
      Text Visibility: ${textVisibility || 'With Text'}.
      Orientation: ${screenOrientation || 'Vertical'}.
      Generate exactly 6 distinctive frames that tell the story using these characters.`;

      return generateForCanvas(uid, {
        prompt: prompt,
        model: 'Qwen Image Edit',
        width: 1024,
        height: 1024,
        imageCount: 6, // Explicitly requesting 6 images per page
        meta: {
          projectId: 'storyboard-workflow',
          pageIndex: pageIndex
        }
      } as any);
    });

    const results = await Promise.all(promiseGenerations);

    // Aggregate results
    // result[0] structure from generateForCanvas typically has { url: string, ... } or { images: [...] }
    // Based on previous controller code: result.images || [{ url: result.url }]

    const allImages: { url: string }[] = [];
    let primaryGenerationId = '';

    results.forEach((res, idx) => {
      if (idx === 0) primaryGenerationId = res.generationId || ''; // Use first ID for history

      if (res.images && Array.isArray(res.images)) {
        allImages.push(...res.images);
      } else if (res.url) {
        allImages.push({ url: res.url });
      }
    });

    return {
      generationId: primaryGenerationId || `sb_${Date.now()}`,
      images: allImages
    };

  } catch (error: any) {
    throw new ApiError(`Storyboard generation failed: ${error.message}`, error.statusCode || 500);
  }
}
