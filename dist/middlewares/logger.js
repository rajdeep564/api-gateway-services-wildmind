"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.httpLogger = void 0;
const pino_http_1 = __importDefault(require("pino-http"));
const logger_1 = require("../utils/logger");
exports.httpLogger = (0, pino_http_1.default)({
    logger: logger_1.requestLogger,
    customProps: (req) => ({ requestId: req.requestId }),
    serializers: {
        req(req) {
            return {
                id: req.id,
                method: req.method,
                url: req.url,
                remoteAddress: req.socket?.remoteAddress,
                remotePort: req.socket?.remotePort,
                headers: {
                    // omit sensitive headers
                    'user-agent': req.headers['user-agent'],
                    'content-type': req.headers['content-type']
                }
            };
        }
    }
});
