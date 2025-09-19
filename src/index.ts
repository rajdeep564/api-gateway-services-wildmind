// Load environment variables first, before any other imports
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import app from './app/app';
import { logger } from './utils/logger';

const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'API Gateway running');
});
