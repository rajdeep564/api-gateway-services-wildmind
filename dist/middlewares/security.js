"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.originCheck = exports.gzipCompression = exports.httpParamPollution = exports.securityHeaders = exports.requestId = void 0;
const helmet_1 = __importDefault(require("helmet"));
const compression_1 = __importDefault(require("compression"));
const hpp_1 = __importDefault(require("hpp"));
const uuid_1 = require("uuid");
const requestId = (req, _res, next) => {
    req.requestId = req.headers['x-request-id'] || (0, uuid_1.v4)();
    next();
};
exports.requestId = requestId;
const isDev = process.env.NODE_ENV !== 'production';
exports.securityHeaders = (0, helmet_1.default)({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            "default-src": ["'self'"],
            "img-src": ["'self'", 'data:', 'https:'],
            "connect-src": [
                "'self'",
                'https://api.bfl.ai',
                'http://localhost:5000', 'http://127.0.0.1:5000',
                'https://api-gateway-services-wildmind.onrender.com',
                'https://api-gateway-services-wildmind.vercel.app'
            ],
        }
    },
    // Disable COOP/COEP to avoid auth popup issues across domains
    crossOriginOpenerPolicy: false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
    frameguard: { action: 'deny' },
    hsts: { maxAge: 15552000, includeSubDomains: true, preload: true },
});
exports.httpParamPollution = (0, hpp_1.default)();
exports.gzipCompression = (0, compression_1.default)();
// Simple Origin/Referer check for state-changing methods (defense-in-depth)
const originCheck = (req, res, next) => {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
        return next();
    }
    const path = req.path || req.url;
    // Allow auth flows (OAuth callbacks may have no/foreign origin)
    if (path.startsWith('/api/auth/'))
        return next();
    const isProd = process.env.NODE_ENV === 'production';
    const defaults = isProd
        ? ['https://wildmindai.com', 'https://www.wildmindai.com']
        : ['http://localhost:3000'];
    const extra = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_ORIGIN || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    const all = [...defaults, ...extra];
    const allowedHosts = new Set();
    for (const o of all) {
        try {
            const u = new URL(o);
            allowedHosts.add(u.host);
        }
        catch { }
    }
    const origin = req.headers.origin || undefined;
    const referer = req.headers.referer || undefined;
    // Allow if no Origin/Referer (server-to-server, OAuth redirects)
    if (!origin && !referer)
        return next();
    try {
        if (origin) {
            const oh = new URL(origin).host;
            if (allowedHosts.has(oh))
                return next();
        }
    }
    catch { }
    try {
        if (referer) {
            const rh = new URL(referer).host;
            if (allowedHosts.has(rh))
                return next();
        }
    }
    catch { }
    return res.status(403).json({ status: 'error', message: 'Forbidden origin' });
};
exports.originCheck = originCheck;
