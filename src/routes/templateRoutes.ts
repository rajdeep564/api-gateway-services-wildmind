import { Router } from 'express';
import { templateController } from '../controllers/templateController';
import { requireAuth } from '../middlewares/authMiddleware';

const router = Router();

// Public routes (or semi-public - listing might be public)
router.get('/', templateController.getTemplates);
router.get('/categories', templateController.getCategories);
router.get('/themes', templateController.getThemes);
router.get('/:id', templateController.getTemplateById);

// Protected routes (Admin operations - ideally separate admin middleware)
// For now, simple requireAuth. Real app should check roles.
router.post('/', requireAuth, templateController.createTemplate);
router.put('/:id', requireAuth, templateController.updateTemplate);
router.delete('/:id', requireAuth, templateController.deleteTemplate);

// Admin seeds
router.post('/categories', requireAuth, templateController.createCategory);
router.post('/themes', requireAuth, templateController.createTheme);

export default router;
