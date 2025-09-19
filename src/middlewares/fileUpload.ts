import multer from 'multer';
import { Request } from 'express';
import { ZataService } from '../services/zataService';

// Configure multer to store files in memory
const storage = multer.memoryStorage();

// File filter function
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Check if file type is supported
  if (ZataService.isValidFileType(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}. Supported types: ${ZataService.getSupportedMimeTypes().join(', ')}`));
  }
};

// Configure multer
export const uploadMiddleware = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 5, // Maximum 5 files at once
  },
});

// Middleware for single file upload
export const uploadSingle = (fieldName: string = 'file') => {
  return uploadMiddleware.single(fieldName);
};

// Middleware for multiple file upload
export const uploadMultiple = (fieldName: string = 'files', maxCount: number = 5) => {
  return uploadMiddleware.array(fieldName, maxCount);
};

// Middleware for multiple fields with files
export const uploadFields = (fields: { name: string; maxCount?: number }[]) => {
  return uploadMiddleware.fields(fields);
};
