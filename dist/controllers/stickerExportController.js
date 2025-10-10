"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stickerExportController = void 0;
exports.exportStickers = exportStickers;
const stickerExportService_1 = require("../services/stickerExportService");
async function exportStickers(req, res, next) {
    try {
        const { images = [], name = 'WildMind Pack', author = 'WildMind AI', single, coverIndex = 0 } = req.body || {};
        const urls = (images || []).map((i) => i?.url).filter(Boolean);
        if (!urls.length)
            return res.status(400).json({ error: 'No images provided' });
        if (single || urls.length === 1) {
            const out = await stickerExportService_1.stickerExportService.buildSingleSticker(urls[0]);
            res.setHeader('Content-Type', out.contentType);
            res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).send(out.buffer);
        }
        const pack = await stickerExportService_1.stickerExportService.buildStickerPack(urls, name, author, coverIndex);
        res.setHeader('Content-Type', pack.contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${pack.filename}"`);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).send(pack.buffer);
    }
    catch (e) {
        next(e);
    }
}
exports.stickerExportController = { exportStickers };
