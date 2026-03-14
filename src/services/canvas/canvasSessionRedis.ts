/**
 * Redis pub-sub for "project opened elsewhere" so it works across multiple backend instances.
 * When any instance receives GET snapshot (new tab/device opened project), it publishes to Redis.
 * All instances (including the one that has the previous tab's WebSocket) receive and broadcast locally.
 */

import { env } from '../../config/env';
import { getRedisClient } from '../../config/redisClient';
import { logger } from '../../utils/logger';

const CHANNEL = 'canvas:projectOpenedElsewhere';

function isRedisAvailable(): boolean {
  return Boolean(env.redisUrl);
}

/**
 * Publish "project opened elsewhere" to Redis so other backend instances can broadcast to their WebSocket clients.
 * Call this from the snapshot controller after notifyProjectOpenedElsewhere (local).
 */
export async function publishProjectOpenedElsewhere(
  projectId: string,
  openerSessionId: string | null
): Promise<void> {
  if (!isRedisAvailable()) return;
  try {
    const client = getRedisClient();
    if (!client) return;
    const message = JSON.stringify({ projectId, openerSessionId });
    await client.publish(CHANNEL, message);
    logger.info({ projectId, openerSessionId }, 'Canvas session: published to Redis');
  } catch (e) {
    logger.warn({ err: (e as Error)?.message, projectId }, 'Canvas session: Redis publish failed');
  }
}

/**
 * Subscribe to Redis for "project opened elsewhere" and call the local broadcaster when a message is received.
 * Call this from the realtime server on startup. Uses a duplicate client (Redis requires subscriber connection to be dedicated).
 */
export function startCanvasSessionRedisSubscriber(
  onMessage: (projectId: string, openerSessionId: string | null) => void
): void {
  if (!isRedisAvailable()) return;
  const main = getRedisClient();
  if (!main) return;
  const sub = main.duplicate();
  sub.on('error', (err: unknown) => {
    logger.warn({ err: (err as Error)?.message }, 'Canvas session: Redis subscriber error');
  });
  sub.connect().then(() => {
    sub.subscribe(CHANNEL, (message: string, _channel?: string) => {
      try {
        const payload = JSON.parse(message) as { projectId?: string; openerSessionId?: string | null };
        if (payload?.projectId) {
          onMessage(payload.projectId, payload.openerSessionId ?? null);
        }
      } catch (_e) {
        logger.warn({ message }, 'Canvas session: invalid Redis message');
      }
    });
    logger.info({ channel: CHANNEL }, 'Canvas session: Redis subscriber started');
  }).catch((e: unknown) => {
    logger.warn({ err: (e as Error)?.message }, 'Canvas session: Redis subscriber connect failed');
  });
}
