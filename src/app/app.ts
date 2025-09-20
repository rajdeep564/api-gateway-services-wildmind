import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import routes from '../routes';
import authRoutes from '../routes/authRoutes';
import { errorHandler } from '../utils/errorHandler';
import dotenv from 'dotenv';
import { formatApiResponse } from '../utils/formatApiResponse';
import { gzipCompression, httpParamPollution, rateLimiter, requestId, securityHeaders } from '../middlewares/security';
import { httpLogger } from '../middlewares/logger';
dotenv.config();

const app = express();

// Trust proxy settings (safe for rate limiting)
const isProd = process.env.NODE_ENV === 'production';
app.set('trust proxy', isProd ? 1 : false);

// Security and common middlewares (SOC2 oriented)
app.use(requestId);
app.use(securityHeaders);
app.use(rateLimiter);
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(httpParamPollution);
app.use(gzipCompression);
app.use(httpLogger);

// Health endpoint
app.get('/health', (_req, res) => {
  res.json(formatApiResponse('success', 'OK', { uptime: process.uptime() }));
});

// API routes
app.use('/api', routes);
app.use(authRoutes);

// Global error handler (should be after all routes)
app.use(errorHandler);

export default app;
