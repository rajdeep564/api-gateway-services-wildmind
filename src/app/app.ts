import express from 'express';
import routes from '../routes';
import { errorHandler } from '../utils/errorHandler';
import dotenv from 'dotenv';
import cors from 'cors';
import morgan from 'morgan';
import { httpLogger } from '../middlewares/logger';
import { formatApiResponse } from '../utils/formatApiResponse';
import { requestId, securityHeaders, httpParamPollution, gzipCompression, rateLimiter } from '../middlewares/security';
// Load environment variables from .env.local first, then .env
dotenv.config({ path: '.env.local' });
dotenv.config();

const app = express();

// Trust proxy (set to false for development to avoid rate limiter warnings)
app.set('trust proxy', false);

// Security and common middlewares (SOC2 oriented)
app.use(requestId);
app.use(securityHeaders);
app.use(rateLimiter);
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(httpParamPollution);
app.use(gzipCompression);
app.use(httpLogger);

// Health endpoint
app.get('/health', (_req, res) => {
  res.json(formatApiResponse('success', 'OK', { uptime: process.uptime() }));
});

// API routes
app.use('/api', routes);

// 404 handler for unmatched routes
app.use((req, res) => {
  res.status(404).json(formatApiResponse('error', 'Route not found', { path: req.path }));
});

// Global error handler (should be last)
app.use(errorHandler);

export default app;
