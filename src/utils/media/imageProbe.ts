import probe from 'probe-image-size';
import { extractKeyFromUrl } from '../storage/zataDelete';
import { getZataSignedGetUrl } from '../storage/zataUpload';

export type ImageMeta = { width?: number; height?: number; type?: string };

export async function probeImageMeta(url: string): Promise<ImageMeta> {
  try {
    const res = await probe(url as any);
    return { width: res?.width, height: res?.height, type: (res as any)?.type };
  } catch (_e) {
    // Fallback: if this is a Zata public URL, probe via a signed GET URL.
    try {
      const key = extractKeyFromUrl(String(url || ''));
      if (key) {
        const signed = await getZataSignedGetUrl(key, 600);
        const res2 = await probe(signed as any);
        return { width: res2?.width, height: res2?.height, type: (res2 as any)?.type };
      }
    } catch { }
    return {};
  }
}
