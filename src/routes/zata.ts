import { Router } from 'express';
import { ZataController } from '../controllers/zataController';
import { uploadSingle, uploadMultiple } from '../middlewares/fileUpload';

const router = Router();

// Upload single file
router.post('/upload', uploadSingle('file'), ZataController.uploadFile);

// Upload multiple files
router.post('/upload-multiple', uploadMultiple('files', 5), ZataController.uploadFiles);

// Get signed download URL
router.get('/signed-url', ZataController.getSignedUrl);

// Get supported file types
router.get('/supported-types', ZataController.getSupportedTypes);

export default router;
