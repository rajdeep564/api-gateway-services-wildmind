import 'dotenv/config';
import app from './app/app';
import { logger } from './utils/logger';
import { env } from './config/env';

const PORT = env.port || 5000;

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'API Gateway running');
});
