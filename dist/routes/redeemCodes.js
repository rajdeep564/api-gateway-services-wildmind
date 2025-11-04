"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const redeemCodeController_1 = require("../controllers/redeemCodeController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = (0, express_1.Router)();
// Apply redeem code (requires authentication)
router.post('/apply', authMiddleware_1.requireAuth, redeemCodeController_1.redeemCodeController.applyRedeemCode);
// Validate redeem code (public endpoint)
router.post('/validate', redeemCodeController_1.redeemCodeController.validateRedeemCode);
// Create redeem codes (admin function)
router.post('/create', redeemCodeController_1.redeemCodeController.createRedeemCodes);
exports.default = router;
