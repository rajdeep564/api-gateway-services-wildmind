"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stickerExportService = void 0;
exports.buildSingleSticker = buildSingleSticker;
exports.buildStickerPack = buildStickerPack;
const sharp_1 = __importDefault(require("sharp"));
const stickerExportRepository_1 = require("../repository/stickerExportRepository");
const OUTPUT_QUALITY_STEPS = [90, 80, 70, 60, 50, 40];
async function removeBackgroundByBorderSampling(input, tolerance = 28) {
    const { data, info } = await (0, sharp_1.default)(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const width = info.width;
    const height = info.height;
    const channels = info.channels;
    const buf = Buffer.from(data);
    const idx = (x, y) => (y * width + x) * channels;
    const corners = [idx(0, 0), idx(width - 1, 0), idx(0, height - 1), idx(width - 1, height - 1)];
    let rb = 0, gb = 0, bb = 0;
    for (const i of corners) {
        rb += buf[i];
        gb += buf[i + 1];
        bb += buf[i + 2];
    }
    rb = Math.round(rb / 4);
    gb = Math.round(gb / 4);
    bb = Math.round(bb / 4);
    const tol2 = tolerance * tolerance;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const p = idx(x, y);
            const dr = buf[p] - rb, dg = buf[p + 1] - gb, db = buf[p + 2] - bb;
            if (dr * dr + dg * dg + db * db <= tol2)
                buf[p + 3] = 0;
        }
    }
    return await (0, sharp_1.default)(buf, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
async function toStickerWebp(input) {
    const bgRemoved = await removeBackgroundByBorderSampling(input).catch(() => input);
    const base = (0, sharp_1.default)(bgRemoved).ensureAlpha();
    const meta = await base.metadata();
    const w = meta.width ?? 1024;
    const h = meta.height ?? 1024;
    const maxSide = Math.max(w, h);
    const padded = await base
        .extend({
        top: Math.floor((maxSide - h) / 2),
        bottom: Math.ceil((maxSide - h) / 2),
        left: Math.floor((maxSide - w) / 2),
        right: Math.ceil((maxSide - w) / 2),
        background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
        .resize(512, 512, { fit: 'cover' })
        .toBuffer();
    for (const quality of OUTPUT_QUALITY_STEPS) {
        const webp = await (0, sharp_1.default)(padded).webp({ quality, lossless: false }).toBuffer();
        if (webp.byteLength < 100 * 1024)
            return webp;
    }
    return await (0, sharp_1.default)(padded).webp({ quality: 35, lossless: false }).toBuffer();
}
async function buildSingleSticker(url) {
    const src = await stickerExportRepository_1.stickerExportRepository.fetchArrayBuffer(url);
    const webp = await toStickerWebp(src);
    return { buffer: webp, filename: 'sticker.webp', contentType: 'image/webp' };
}
async function buildStickerPack(urls, name, author, coverIndex = 0) {
    // dynamic import for adm-zip
    const AdmZip = (await Promise.resolve().then(() => __importStar(require('adm-zip')))).default;
    const zip = new AdmZip();
    const names = [];
    for (let i = 0; i < Math.min(30, urls.length); i++) {
        const src = await stickerExportRepository_1.stickerExportRepository.fetchArrayBuffer(urls[i]);
        const webp = await toStickerWebp(src);
        const nm = `${String(i + 1).padStart(3, '0')}.webp`;
        names.push(nm);
        zip.addFile(nm, webp);
    }
    const pack = { name, author, cover: names[coverIndex] || names[0], stickers: names };
    zip.addFile('pack.json', Buffer.from(JSON.stringify(pack, null, 2)));
    return { buffer: zip.toBuffer(), filename: 'whatsapp-pack.zip', contentType: 'application/zip' };
}
exports.stickerExportService = {
    buildSingleSticker,
    buildStickerPack,
};
