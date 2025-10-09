"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const publicGenerationsController_1 = require("../controllers/publicGenerationsController");
const validatePublicGenerations_1 = require("../middlewares/validatePublicGenerations");
const router = (0, express_1.Router)();
// Public generations endpoints (no authentication required)
// Preflight support
router.options('/', (_req, res) => res.sendStatus(204));
router.options('/:generationId', (_req, res) => res.sendStatus(204));
// Optional HEAD handlers (some proxies send HEAD and expect 200)
router.head('/', validatePublicGenerations_1.validatePublicListGenerations, validatePublicGenerations_1.handleValidationErrors, publicGenerationsController_1.publicGenerationsController.listPublic);
router.head('/:generationId', validatePublicGenerations_1.validateGenerationId, validatePublicGenerations_1.handleValidationErrors, publicGenerationsController_1.publicGenerationsController.getPublicById);
router.get('/', validatePublicGenerations_1.validatePublicListGenerations, validatePublicGenerations_1.handleValidationErrors, publicGenerationsController_1.publicGenerationsController.listPublic);
router.get('/:generationId', validatePublicGenerations_1.validateGenerationId, validatePublicGenerations_1.handleValidationErrors, publicGenerationsController_1.publicGenerationsController.getPublicById);
exports.default = router;
