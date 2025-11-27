import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import { validateLibrary, validateUploads } from '../middlewares/validators/library/validateLibrary';
import { handleValidationErrors } from '../middlewares/validateGenerations';
import * as libraryController from '../controllers/libraryController';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// Get user's library (generated images/videos)
// Query params: limit, cursor, nextCursor, mode (image|video|music|branding|all)
router.get('/library', validateLibrary as any, handleValidationErrors, libraryController.getLibrary);

// Get user's uploads (inputImages/inputVideos)
// Query params: limit, cursor, nextCursor, mode (image|video|music|branding|all)
router.get('/uploads', validateUploads as any, handleValidationErrors, libraryController.getUploads);

// Save an upload explicitly for WildMind AI (not canvas)
router.post('/uploads/save', libraryController.saveUploadForWild);

export default router;

