"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const app_1 = __importDefault(require("./app/app"));
const logger_1 = require("./utils/logger");
const env_1 = require("./config/env");
const PORT = env_1.env.port || 5000;
app_1.default.listen(PORT, () => {
    logger_1.logger.info({ port: PORT }, 'API Gateway running');
});
