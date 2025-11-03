"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.__placeholder = exports.s3 = exports.ZATA_BUCKET = exports.ZATA_ENDPOINT = void 0;
exports.makeZataPublicUrl = makeZataPublicUrl;
// utils/storage/zataClient.ts
const client_s3_1 = require("@aws-sdk/client-s3");
const node_http_handler_1 = require("@smithy/node-http-handler");
const node_https_1 = require("node:https");
const env_1 = require("../../config/env");
exports.ZATA_ENDPOINT = env_1.env.zataEndpoint;
exports.ZATA_BUCKET = env_1.env.zataBucket;
const ZATA_REGION = env_1.env.zataRegion;
const ZATA_FORCE_PATH_STYLE = env_1.env.zataForcePathStyle;
const ZATA_ACCESS_KEY_ID = env_1.env.zataAccessKeyId;
const ZATA_SECRET_ACCESS_KEY = env_1.env.zataSecretAccessKey;
const httpsAgent = new node_https_1.Agent({
    keepAlive: true,
    maxSockets: 64,
    // Prefer IPv4 to avoid AAAA blackholes
    family: 4,
});
exports.s3 = new client_s3_1.S3Client({
    region: ZATA_REGION,
    endpoint: exports.ZATA_ENDPOINT,
    forcePathStyle: ZATA_FORCE_PATH_STYLE,
    // keep a retry or two for transient network issues; 1 is fine for diagnostics
    maxAttempts: 1,
    requestHandler: new node_http_handler_1.NodeHttpHandler({
        connectionTimeout: 3000, // time to establish TCP/TLS
        requestTimeout: 8000, // hard cap for the entire request (THIS is the important one)
        httpsAgent,
    }),
    credentials: {
        accessKeyId: ZATA_ACCESS_KEY_ID,
        secretAccessKey: ZATA_SECRET_ACCESS_KEY,
    },
});
function makeZataPublicUrl(key) {
    return `${exports.ZATA_ENDPOINT}/${exports.ZATA_BUCKET}/${encodeURI(key)}`;
}
exports.__placeholder = 0;
