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
import * as queryController from '../controllers/canvas/queryController';
import multer from 'multer';
import os from 'os';
import path from 'path';

const router = Router();

const upload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, os.tmpdir()),
        filename: (_req, file, cb) => {
            const ext = path.extname(file.originalname || '').toLowerCase();
            const safeExt = ext && ext.length <= 12 ? ext : '';
            const name = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${safeExt}`;
            cb(null, name);
        },
    }),
    limits: {
        fileSize: 200 * 1024 * 1024, // 200MB
    },
});

// All routes require authentication
router.use(requireAuth);

// Projects
router.post('/projects', projectsController.createProject);
router.get('/projects', projectsController.listProjects);
router.get('/projects/:id', projectsController.getProject);
router.patch('/projects/:id', projectsController.updateProject);
router.delete('/projects/:id', projectsController.deleteProject);
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

import { makeCreditCost } from '../middlewares/creditCostFactory';
import {
    computeCanvasGenerateCost,
    computeCanvasVideoCost,
    computeCanvasUpscaleCost,
    computeCanvasRemoveBgCost,
    computeCanvasVectorizeCost,
    computeCanvasEraseCost,
    computeCanvasReplaceCost,
    computeCanvasScriptCost,
    computeCanvasNextSceneCost
} from '../utils/pricing/canvasPricing';

// Generation (Canvas-specific)
// @ts-ignore
router.post('/generate', validateCanvasGenerate, makeCreditCost('canvas', 'generate', computeCanvasGenerateCost), generateController.generateForCanvas);
// @ts-ignore
router.post('/generate-video', requireAuth, makeCreditCost('canvas', 'generate-video', computeCanvasVideoCost), generateController.generateVideoForCanvas);
// @ts-ignore
router.post('/upscale', requireAuth, makeCreditCost('canvas', 'upscale', computeCanvasUpscaleCost), generateController.upscaleForCanvas);
// @ts-ignore
router.post('/removebg', requireAuth, makeCreditCost('canvas', 'removebg', computeCanvasRemoveBgCost), generateController.removeBgForCanvas);
// @ts-ignore
router.post('/vectorize', requireAuth, makeCreditCost('canvas', 'vectorize', computeCanvasVectorizeCost), generateController.vectorizeForCanvas);
// @ts-ignore
router.post('/erase', requireAuth, makeCreditCost('canvas', 'erase', computeCanvasEraseCost), generateController.eraseForCanvas);
// @ts-ignore
router.post('/replace', requireAuth, makeCreditCost('canvas', 'replace', computeCanvasReplaceCost), generateController.replaceForCanvas);
// @ts-ignore
router.post('/next-scene', requireAuth, makeCreditCost('canvas', 'next-scene', computeCanvasNextSceneCost), generateController.generateNextSceneForCanvas);
router.post('/create-stitched-reference', requireAuth, generateController.createStitchedReferenceImage);

// Query (Canvas prompt enhancement)
router.post('/query', queryController.queryCanvas);
// @ts-ignore
router.post('/generate-scenes', makeCreditCost('canvas', 'generate-scenes', computeCanvasScriptCost), queryController.generateScenes);

// Media Library
router.get('/media-library', mediaLibraryController.getMediaLibrary);
router.post('/media-library/upload', mediaLibraryController.saveUploadedMedia);
router.post('/media-library/upload-file', upload.single('file'), mediaLibraryController.uploadMediaFile);

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