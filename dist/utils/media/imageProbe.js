"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.probeImageMeta = probeImageMeta;
const probe_image_size_1 = __importDefault(require("probe-image-size"));
async function probeImageMeta(url) {
    try {
        const res = await (0, probe_image_size_1.default)(url);
        return { width: res?.width, height: res?.height, type: res?.type };
    }
    catch (_e) {
        return {};
    }
}
