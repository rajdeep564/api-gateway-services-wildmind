import 'dotenv/config';
import app from './app/app';
import type { Server as HttpServer } from 'http';
import { startRealtimeServer } from './websocket/realtimeServer';
import { logger } from './utils/logger';
import { env } from './config/env';

const PORT = env.port || 5001;

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
