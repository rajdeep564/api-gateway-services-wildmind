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
const env_1 = require("../config/env");
const creditsService_1 = require("../services/creditsService");
const redisClient_1 = require("../config/redisClient");
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
// Strong preflight guard + always-set CORS headers (defensive against proxies/edges)
const allowOrigin = (origin) => {
    if (!origin)
        return false;
    try {
        if (allowedOrigins.includes(origin))
            return true;
        if (process.env.FRONTEND_ORIGIN) {
            const allowHost = new URL(process.env.FRONTEND_ORIGIN).hostname;
            const reqHost = new URL(origin).hostname;
            if (reqHost === allowHost || reqHost.endsWith(`.${allowHost}`))
                return true;
        }
    }
    catch { }
    return false;
};
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (allowOrigin(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Vary', 'Origin');
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Request-Id, X-Device-Id, X-Device-Name, X-Device-Info, ngrok-skip-browser-warning, Range');
    }
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    return next();
});
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
// Auth config health (does not leak secrets)
app.get('/health/auth', (_req, res) => {
    try {
        const info = {
            firebaseApiKeyPresent: Boolean(env_1.env.firebaseApiKey),
            firebaseProjectId: env_1.env.firebaseProjectId || null,
            nodeEnv: env_1.env.nodeEnv,
        };
        return res.json((0, formatApiResponse_1.formatApiResponse)('success', 'OK', info));
    }
    catch (_e) {
        return res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Error', { firebaseApiKeyPresent: false }));
    }
});
// Redis health (optional): reports if Redis cache is enabled and ping works
app.get('/health/redis', async (_req, res) => {
    try {
        if (!(0, redisClient_1.isRedisEnabled)()) {
            return res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Redis disabled', { enabled: false }));
        }
        const client = (0, redisClient_1.getRedisClient)();
        if (!client) {
            return res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Redis not initialized', { enabled: true, initialized: false }));
        }
        try {
            const pong = await client.ping();
            return res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Redis OK', { enabled: true, initialized: true, pong: pong === 'PONG' }));
        }
        catch (_e) {
            return res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Redis ping failed', { enabled: true, initialized: true, pong: false }));
        }
    }
    catch (_e) {
        return res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Redis check error', { enabled: false }));
    }
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
// Initialize Redis connection in background (non-blocking) when configured
(async () => {
    try {
        if ((0, redisClient_1.isRedisEnabled)())
            (0, redisClient_1.getRedisClient)();
    }
    catch (_e) { }
})();
