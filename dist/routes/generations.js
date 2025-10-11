"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const generationHistoryController_1 = require("../controllers/generationHistoryController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const validateGenerations_1 = require("../middlewares/validateGenerations");
const router = (0, express_1.Router)();
// Internal/admin-only endpoints removed to automate flow within provider services
router.get('/', authMiddleware_1.requireAuth, validateGenerations_1.validateListGenerations, validateGenerations_1.handleValidationErrors, generationHistoryController_1.generationHistoryController.listMine);
router.get('/:historyId', authMiddleware_1.requireAuth, generationHistoryController_1.generationHistoryController.get);
router.delete('/:historyId', authMiddleware_1.requireAuth, generationHistoryController_1.generationHistoryController.softDelete);
exports.default = router;
