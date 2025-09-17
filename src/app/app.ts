import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import routes from '../routes';
import authRoutes from '../routes/authRoutes';
import { errorHandler } from '../utils/errorHandler';
import dotenv from 'dotenv';
dotenv.config();

const app = express();

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

app.use('/api', routes);
app.use(authRoutes);

// Global error handler (should be after all routes)
app.use(errorHandler);

export default app;
