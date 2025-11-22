import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import { validateCanvasGenerate } from '../middlewares/validators/canvas/validateCanvasGenerate';
import * as projectsController from '../controllers/canvas/projectsController';
// Ops API removed: local-only undo/redo with realtime updates
// import * as opsController from '../controllers/canvas/opsController';
import * as snapshotController from '../controllers/canvas/snapshotController';
import * as generateController from '../controllers/canvas/generateController';
import * as cursorAgentController from '../controllers/canvas/cursorAgentController';
import * as workersController from '../controllers/canvas/workersController';
import * as presenceController from '../websocket/canvasPresenceServer';
import * as mediaLibraryController from '../controllers/canvas/mediaLibraryController';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// Projects
router.post('/projects', projectsController.createProject);
router.get('/projects', projectsController.listProjects);
router.get('/projects/:id', projectsController.getProject);
router.patch('/projects/:id', projectsController.updateProject);
router.post('/projects/:id/collaborators', projectsController.addCollaborator);

// Operations
// Removed ops routes to reduce server-side op churn
// router.post('/projects/:id/ops', opsController.appendOp);
// router.get('/projects/:id/ops', opsController.getOps);

// Snapshots
router.get('/projects/:id/snapshot', snapshotController.getSnapshot);
router.post('/projects/:id/snapshot', snapshotController.createSnapshot);
// Overwrite snapshot (current state) APIs
router.get('/projects/:id/snapshot/current', snapshotController.getCurrentSnapshot);
router.put('/projects/:id/snapshot/current', snapshotController.setCurrentSnapshot);

// Generation (Canvas-specific)
router.post('/generate', validateCanvasGenerate, generateController.generateForCanvas);
router.post('/generate-video', requireAuth, generateController.generateVideoForCanvas);
router.post('/upscale', requireAuth, generateController.upscaleForCanvas);
router.post('/removebg', requireAuth, generateController.removeBgForCanvas);
router.post('/vectorize', requireAuth, generateController.vectorizeForCanvas);

// Media Library
router.get('/media-library', mediaLibraryController.getMediaLibrary);
router.post('/media-library/upload', mediaLibraryController.saveUploadedMedia);

// Cursor Agent
router.post('/agent/plan', cursorAgentController.planAgentActions);
router.post('/agent/execute', cursorAgentController.executeAgentPlan);

// Workers (admin/maintenance endpoints)
router.post('/workers/snapshot', workersController.triggerSnapshot);
router.post('/workers/media-gc', workersController.triggerMediaGC);

// Presence (real-time collaboration)
router.post('/projects/:id/presence', presenceController.updatePresence);
router.get('/projects/:id/presence', presenceController.getPresences);
router.delete('/projects/:id/presence', presenceController.removePresence);

export default router;