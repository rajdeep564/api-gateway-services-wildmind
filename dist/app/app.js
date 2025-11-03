"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const routes_1 = __importDefault(require("../routes"));
const errorHandler_1 = require("../utils/errorHandler");
const dotenv_1 = __importDefault(require("dotenv"));
const formatApiResponse_1 = require("../utils/formatApiResponse");
const security_1 = require("../middlewares/security");
const logger_1 = require("../middlewares/logger");
const creditsService_1 = require("../services/creditsService");
dotenv_1.default.config();
const app = (0, express_1.default)();
// Trust proxy settings (safe for rate limiting)
const isProd = process.env.NODE_ENV === 'production';
app.set('trust proxy', isProd ? 1 : false);
// Security and common middlewares (SOC2 oriented)
app.use(security_1.requestId);
app.use(security_1.securityHeaders);
// CORS for frontend with credentials (dev + prod)
const isProdEnv = process.env.NODE_ENV === 'production';
const allowedOrigins = [
    // Common prod hosts for frontend
    ...(isProdEnv ? ['https://www.wildmindai.com', 'https://wildmindai.com'] : []),
    process.env.FRONTEND_ORIGIN || '',
    ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()) : [])
].filter(Boolean);
const corsOptions = {
    origin: (origin, callback) => {
        // Allow server-to-server (no Origin header) and health checks
        if (!origin)
            return callback(null, true);
        try {
            if (allowedOrigins.includes(origin))
                return callback(null, true);
            // Allow subdomains of the configured prod origin (e.g., preview/app)
            if (process.env.FRONTEND_ORIGIN) {
                const allowHost = new URL(process.env.FRONTEND_ORIGIN).hostname;
                const reqHost = new URL(origin).hostname;
                if (reqHost === allowHost || reqHost.endsWith(`.${allowHost}`)) {
                    return callback(null, true);
                }
            }
        }
        catch { }
        return callback(new Error('CORS blocked: origin not allowed'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'X-Request-Id',
        'X-Device-Id',
        'X-Device-Name',
        'X-Device-Info',
        'ngrok-skip-browser-warning',
        'Range'
    ],
    optionsSuccessStatus: 204,
    exposedHeaders: ['Content-Length', 'Content-Range']
};
app.use((0, cors_1.default)(corsOptions));
app.options('*', (0, cors_1.default)(corsOptions));
app.use(express_1.default.json({ limit: '50mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '50mb' }));
app.use((0, cookie_parser_1.default)());
app.use(security_1.httpParamPollution);
app.use(security_1.gzipCompression);
app.use(logger_1.httpLogger);
if (isProd) {
    app.use(security_1.originCheck);
}
// Health endpoint
app.get('/health', (_req, res) => {
    res.json((0, formatApiResponse_1.formatApiResponse)('success', 'OK', { uptime: process.uptime() }));
});
// API routes
app.use('/api', routes_1.default);
// Global error handler (should be after all routes)
app.use(errorHandler_1.errorHandler);
exports.default = app;
// Minimal FREE plan seed on bootstrap (non-blocking)
(async () => {
    try {
        await creditsService_1.creditsService.ensurePlansSeeded();
    }
    catch (_e) { }
})();
