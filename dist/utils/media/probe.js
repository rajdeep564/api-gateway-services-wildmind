"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.probeVideoMeta = probeVideoMeta;
const child_process_1 = require("child_process");
const ffprobe_static_1 = __importDefault(require("ffprobe-static"));
function parseFps(rate) {
    if (!rate)
        return undefined;
    const [num, den] = String(rate).split('/').map((v) => Number(v));
    if (!isFinite(num) || !isFinite(den) || den === 0)
        return undefined;
    return num / den;
}
async function probeVideoMeta(url) {
    // Use ffprobe to fetch stream and format info in JSON
    const args = [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,avg_frame_rate,nb_frames',
        '-show_entries', 'format=duration',
        '-of', 'json',
        url,
    ];
    return new Promise((resolve) => {
        const bin = ffprobe_static_1.default?.path || ffprobe_static_1.default;
        (0, child_process_1.execFile)(String(bin), args, { timeout: 10000 }, (err, stdout) => {
            if (err || !stdout)
                return resolve({});
            try {
                const data = JSON.parse(stdout.toString());
                const stream = Array.isArray(data.streams) ? data.streams[0] : undefined;
                const format = data.format || {};
                const width = stream?.width ? Number(stream.width) : undefined;
                const height = stream?.height ? Number(stream.height) : undefined;
                const fps = parseFps(stream?.avg_frame_rate);
                const frames = stream?.nb_frames ? Number(stream.nb_frames) : undefined;
                const durationSec = format?.duration ? Number(format.duration) : undefined;
                let computedFrames = frames;
                if ((!computedFrames || !isFinite(computedFrames)) && durationSec && fps) {
                    computedFrames = Math.max(1, Math.round(durationSec * fps));
                }
                resolve({ width, height, durationSec, fps, frames: computedFrames });
            }
            catch {
                resolve({});
            }
        });
    });
}
