import dotenv from 'dotenv';
// Trigger restart: 2025-12-31T07:11:00Z
import path from 'path';

// Load .env file from project root
// Use process.cwd() which points to the project root when server is started
const envPath = path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });

// Import env after dotenv.config loads the .env file
import { env } from './config/env';

// Debug: Log if .env was loaded (only in development)
if (env.nodeEnv !== 'production') {
  console.log(`[ENV] Loading .env from: ${envPath}`);
  console.log(`[ENV] GOOGLE_GENAI_API_KEY exists: ${!!env.googleGenAIApiKey}`);
  console.log(`[ENV] GENAI_API_KEY exists: ${!!env.googleGenAIApiKey}`); // Same value, env.ts handles both
}

import app from './app/app';
import type { Server as HttpServer } from 'http';
import { startRealtimeServer } from './websocket/realtimeServer';
import { logger } from './utils/logger';

const PORT = env.port || 5000;

const server: HttpServer = app.listen(PORT, () => {
  logger.info({ port: PORT }, 'API Gateway running');
});
// Increase timeout to 7.5 minutes (450s) to match application timeout
server.setTimeout(450000);

// Graceful shutdown handler
let isShuttingDown = false;

const gracefulShutdown = (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.warn({ signal }, `Received ${signal}, starting graceful shutdown...`);

  // Stop accepting new connections
  server.close((err) => {
    if (err) {
      logger.error({ err }, 'Error during server close');
      process.exit(1);
    }
    
    logger.info('Server closed, all connections drained');
    process.exit(0);
  });

  // Force exit after 30 seconds if graceful shutdown hangs
  setTimeout(() => {
    logger.error('Graceful shutdown timeout, forcing exit');
    process.exit(1);
  }, 30000);
};

// Handle termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception, shutting down');
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled rejection, shutting down');
  gracefulShutdown('unhandledRejection');
});


// Start WebSocket server on the same HTTP server at /realtime
try {
  startRealtimeServer(server);
  logger.info({ path: '/realtime' }, 'Realtime WS attached');
} catch (e) {
  logger.warn({ err: String(e) }, 'Failed to start Realtime WS');
}
