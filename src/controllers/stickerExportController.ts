import { Request, Response, NextFunction } from 'express';
import { stickerExportService } from '../services/stickerExportService';

export async function exportStickers(req: Request, res: Response, next: NextFunction) {
  try {
    const { images = [], name = 'WildMind Pack', author = 'WildMind AI', single, coverIndex = 0 } = req.body || {};
    const urls: string[] = (images || []).map((i: any) => i?.url).filter(Boolean);
    if (!urls.length) return res.status(400).json({ error: 'No images provided' });

    if (single || urls.length === 1) {
      const out = await stickerExportService.buildSingleSticker(urls[0]);
      res.setHeader('Content-Type', out.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(out.buffer);
    }

    const pack = await stickerExportService.buildStickerPack(urls, name, author, coverIndex);
    res.setHeader('Content-Type', pack.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${pack.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(pack.buffer);
  } catch (e) {
    next(e);
  }
}

export const stickerExportController = { exportStickers };


