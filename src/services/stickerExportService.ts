import sharp from 'sharp';
import { stickerExportRepository } from '../repository/stickerExportRepository';

const OUTPUT_QUALITY_STEPS = [90, 80, 70, 60, 50, 40];

async function removeBackgroundByBorderSampling(input: Buffer, tolerance: number = 28): Promise<Buffer> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true }) as any;
  const width = info.width as number; const height = info.height as number; const channels = info.channels as number;
  const buf = Buffer.from(data);
  const idx = (x: number, y: number) => (y * width + x) * channels;
  const corners = [idx(0,0), idx(width-1,0), idx(0,height-1), idx(width-1,height-1)];
  let rb = 0, gb = 0, bb = 0;
  for (const i of corners) { rb += buf[i]; gb += buf[i+1]; bb += buf[i+2]; }
  rb = Math.round(rb / 4); gb = Math.round(gb / 4); bb = Math.round(bb / 4);
  const tol2 = tolerance * tolerance;
  for (let y=0;y<height;y++){
    for (let x=0;x<width;x++){
      const p = idx(x,y);
      const dr = buf[p]-rb, dg = buf[p+1]-gb, db = buf[p+2]-bb;
      if (dr*dr+dg*dg+db*db <= tol2) buf[p+3] = 0;
    }
  }
  return await sharp(buf, { raw: { width, height, channels: 4 }}).png().toBuffer();
}

async function toStickerWebp(input: Buffer): Promise<Buffer> {
  const bgRemoved = await removeBackgroundByBorderSampling(input).catch(()=>input);
  const base = sharp(bgRemoved).ensureAlpha();
  const meta = await base.metadata();
  const w = meta.width ?? 1024; const h = meta.height ?? 1024; const maxSide = Math.max(w,h);
  const padded = await base
    .extend({
      top: Math.floor((maxSide - h) / 2),
      bottom: Math.ceil((maxSide - h) / 2),
      left: Math.floor((maxSide - w) / 2),
      right: Math.ceil((maxSide - w) / 2),
      background: { r:0,g:0,b:0,alpha:0 },
    })
    .resize(512,512,{ fit:'cover' })
    .toBuffer();

  for (const quality of OUTPUT_QUALITY_STEPS) {
    const webp = await sharp(padded).webp({ quality, lossless: false }).toBuffer();
    if (webp.byteLength < 100*1024) return webp;
  }
  return await sharp(padded).webp({ quality: 35, lossless: false }).toBuffer();
}

export async function buildSingleSticker(url: string): Promise<{ buffer: Buffer, filename: string, contentType: string }>{
  const src = await stickerExportRepository.fetchArrayBuffer(url);
  const webp = await toStickerWebp(src);
  return { buffer: webp, filename: 'sticker.webp', contentType: 'image/webp' };
}

export async function buildStickerPack(urls: string[], name: string, author: string, coverIndex: number = 0): Promise<{ buffer: Buffer, filename: string, contentType: string }>{
  // dynamic import for adm-zip
  const AdmZip = (await import('adm-zip')).default as any;
  const zip = new AdmZip();
  const names: string[] = [];
  for (let i=0;i<Math.min(30, urls.length);i++){
    const src = await stickerExportRepository.fetchArrayBuffer(urls[i]);
    const webp = await toStickerWebp(src);
    const nm = `${String(i+1).padStart(3,'0')}.webp`;
    names.push(nm);
    zip.addFile(nm, webp);
  }
  const pack = { name, author, cover: names[coverIndex] || names[0], stickers: names };
  zip.addFile('pack.json', Buffer.from(JSON.stringify(pack, null, 2)));
  return { buffer: zip.toBuffer(), filename: 'whatsapp-pack.zip', contentType: 'application/zip' };
}

export const stickerExportService = {
  buildSingleSticker,
  buildStickerPack,
};


