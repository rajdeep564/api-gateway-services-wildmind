import dotenv from 'dotenv';
import path from 'path';

// Load .env file from project root
// Use process.cwd() which points to the project root when server is started
const envPath = path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });

// Debug: Log if .env was loaded (only in development)
if (process.env.NODE_ENV !== 'production') {
  console.log(`[ENV] Loading .env from: ${envPath}`);
  console.log(`[ENV] GOOGLE_GENAI_API_KEY exists: ${!!process.env.GOOGLE_GENAI_API_KEY}`);
  console.log(`[ENV] GENAI_API_KEY exists: ${!!process.env.GENAI_API_KEY}`);
}

import app from './app/app';
import type { Server as HttpServer } from 'http';
import { startRealtimeServer } from './websocket/realtimeServer';
import { logger } from './utils/logger';
import { env } from './config/env';

const PORT = env.port || 5000;

const server: HttpServer = app.listen(PORT, () => {
  logger.info({ port: PORT }, 'API Gateway running');
});

// Start WebSocket server on the same HTTP server at /realtime
try {
  startRealtimeServer(server);
  logger.info({ path: '/realtime' }, 'Realtime WS attached');
} catch (e) {
  logger.warn({ err: String(e) }, 'Failed to start Realtime WS');
}
