import probe from 'probe-image-size';

export type ImageMeta = { width?: number; height?: number; type?: string };

export async function probeImageMeta(url: string): Promise<ImageMeta> {
  try {
    const res = await probe(url as any);
    return { width: res?.width, height: res?.height, type: (res as any)?.type };
  } catch (_e) {
    return {};
  }
}
