"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadBufferToZata = uploadBufferToZata;
exports.uploadFromUrlToZata = uploadFromUrlToZata;
exports.getZataSignedGetUrl = getZataSignedGetUrl;
exports.uploadDataUriToZata = uploadDataUriToZata;
// zataUpload.ts
const axios_1 = __importDefault(require("axios"));
const client_s3_1 = require("@aws-sdk/client-s3");
const zataClient_1 = require("./zataClient");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
function guessExtensionFromContentType(contentType, fallback = 'bin') {
    if (!contentType)
        return fallback;
    if (contentType.includes('jpeg'))
        return 'jpg';
    if (contentType.includes('jpg'))
        return 'jpg';
    if (contentType.includes('png'))
        return 'png';
    if (contentType.includes('webp'))
        return 'webp';
    if (contentType.includes('gif'))
        return 'gif';
    if (contentType.includes('mp4'))
        return 'mp4';
    if (contentType.includes('webm'))
        return 'webm';
    if (contentType.includes('mpeg'))
        return 'mp3';
    if (contentType.includes('wav'))
        return 'wav';
    if (contentType.includes('ogg'))
        return 'ogg';
    return fallback;
}
async function uploadBufferToZata(key, buffer, contentType) {
    const cmd = new client_s3_1.PutObjectCommand({
        Bucket: zataClient_1.ZATA_BUCKET,
        Key: key,
        ContentType: contentType || 'application/octet-stream',
        Body: buffer,
    });
    const out = await zataClient_1.s3.send(cmd);
    const publicUrl = (0, zataClient_1.makeZataPublicUrl)(key);
    return { key, publicUrl, etag: out?.ETag };
}
async function uploadFromUrlToZata(params) {
    const { sourceUrl, keyPrefix, fileName } = params;
    const resp = await axios_1.default.get(sourceUrl, {
        responseType: 'arraybuffer',
        validateStatus: () => true,
    });
    if (resp.status < 200 || resp.status >= 300) {
        throw new Error(`Download failed (${resp.status}) for ${sourceUrl}`);
    }
    const contentType = resp.headers['content-type'] || undefined;
    const extFromUrl = (() => {
        try {
            const u = new URL(sourceUrl);
            const path = u.pathname;
            const idx = path.lastIndexOf('.');
            return idx >= 0 ? path.substring(idx + 1).toLowerCase() : undefined;
        }
        catch {
            return undefined;
        }
    })();
    const ext = extFromUrl || guessExtensionFromContentType(contentType);
    const baseName = fileName || `${Date.now()}`;
    const normalizedPrefix = keyPrefix.replace(/\/$/, '');
    const key = `${normalizedPrefix}/${baseName}.${ext}`;
    const buffer = Buffer.from(resp.data);
    const { publicUrl, etag } = await uploadBufferToZata(key, buffer, contentType || 'application/octet-stream');
    return { key, publicUrl, etag, originalUrl: sourceUrl, contentType };
}
async function getZataSignedGetUrl(key, expiresInSeconds = 600) {
    const cmd = new client_s3_1.GetObjectCommand({ Bucket: zataClient_1.ZATA_BUCKET, Key: key });
    const url = await (0, s3_request_presigner_1.getSignedUrl)(zataClient_1.s3, cmd, { expiresIn: expiresInSeconds });
    return url;
}
async function uploadDataUriToZata(params) {
    const { dataUri, keyPrefix, fileName } = params;
    // data:[mime];base64,xxxxx
    const match = /^data:([^;]+);base64,(.*)$/.exec(dataUri);
    if (!match)
        throw new Error('Invalid data URI');
    const contentType = match[1];
    const base64 = match[2];
    const buffer = Buffer.from(base64, 'base64');
    const ext = guessExtensionFromContentType(contentType);
    const baseName = fileName || `${Date.now()}`;
    const normalizedPrefix = keyPrefix.replace(/\/$/, '');
    const key = `${normalizedPrefix}/${baseName}.${ext}`;
    const { publicUrl, etag } = await uploadBufferToZata(key, buffer, contentType || 'application/octet-stream');
    return { key, publicUrl, etag, contentType };
}
