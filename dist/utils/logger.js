"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestLogger = exports.logger = void 0;
const pino_1 = __importDefault(require("pino"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const env_1 = require("../config/env");
const isDev = env_1.env.nodeEnv !== "production";
exports.logger = (0, pino_1.default)({
    level: env_1.env.logLevel || "info",
    transport: isDev
        ? {
            target: "pino-pretty",
            options: { colorize: true, translateTime: true, singleLine: false },
        }
        : undefined,
    base: undefined,
    redact: {
        paths: [
            "req.headers.authorization",
            "req.headers.cookie",
            "password",
            "token",
        ],
        remove: true,
    },
});
// Ensure logs directory exists
const logsDir = path_1.default.resolve(process.cwd(), "logs");
try {
    if (!fs_1.default.existsSync(logsDir)) {
        fs_1.default.mkdirSync(logsDir, { recursive: true });
    }
}
catch (_e) {
    // ignore mkdir errors
}
// Dedicated request logger writing to file (non-blocking async mode)
const requestLogPath = path_1.default.join(logsDir, "requests.log");
const requestDestination = pino_1.default.destination({ dest: requestLogPath, sync: false });
exports.requestLogger = (0, pino_1.default)({
    level: env_1.env.logLevel || "info",
    base: undefined,
    redact: {
        paths: [
            "req.headers.authorization",
            "req.headers.cookie",
            "password",
            "token",
        ],
        remove: true,
    },
}, requestDestination);
