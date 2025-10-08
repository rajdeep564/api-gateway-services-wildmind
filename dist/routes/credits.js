"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const creditsController_1 = require("../controllers/creditsController");
const router = (0, express_1.Router)();
router.get('/me', authMiddleware_1.requireAuth, creditsController_1.creditsController.me);
exports.default = router;
