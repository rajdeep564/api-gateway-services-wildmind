"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stickerExportRepository = void 0;
exports.fetchArrayBuffer = fetchArrayBuffer;
const node_fetch_1 = __importDefault(require("node-fetch"));
async function fetchArrayBuffer(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
        const res = await (0, node_fetch_1.default)(url, { signal: controller.signal });
        if (!res.ok)
            throw new Error(`fetch ${url} -> ${res.status}`);
        const arr = await res.arrayBuffer();
        return Buffer.from(arr);
    }
    finally {
        clearTimeout(timeout);
    }
}
exports.stickerExportRepository = {
    fetchArrayBuffer,
};
