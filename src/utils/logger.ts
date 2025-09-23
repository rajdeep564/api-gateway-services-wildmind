import pino from "pino";
import fs from "fs";
import path from "path";
import { env } from "../config/env";

const isDev = env.nodeEnv !== "production";

export const logger = pino({
  level: env.logLevel || "info",
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
const logsDir = path.resolve(process.cwd(), "logs");
try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
} catch (_e) {
  // ignore mkdir errors
}

// Dedicated request logger writing to file (non-blocking async mode)
const requestLogPath = path.join(logsDir, "requests.log");
const requestDestination = pino.destination({ dest: requestLogPath, sync: false });

export const requestLogger = pino({
  level: env.logLevel || "info",
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
