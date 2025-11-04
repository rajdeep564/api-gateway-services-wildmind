"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const stickerExportController_1 = require("../controllers/stickerExportController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = (0, express_1.Router)();
// Export stickers to WhatsApp-ready formats
router.post('/export', authMiddleware_1.requireAuth, stickerExportController_1.exportStickers);
exports.default = router;
