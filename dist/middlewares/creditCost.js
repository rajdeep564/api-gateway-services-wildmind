"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.creditCost = creditCost;
const errorHandler_1 = require("../utils/errorHandler");
const bflutils_1 = require("../utils/bflutils");
const creditDistribution_1 = require("../data/creditDistribution");
const uuid_1 = require("uuid");
const creditsService_1 = require("../services/creditsService");
const logger_1 = require("../utils/logger");
async function ensureUserInit(uid) {
    const doc = await creditsService_1.creditsService.ensureUserInit(uid);
    return { creditBalance: doc.creditBalance, planCode: doc.planCode };
}
async function creditCost(req, res, next) {
    try {
        const uid = req.uid;
        if (!uid)
            throw new errorHandler_1.ApiError('Unauthorized', 401);
        const { model, n = 1, frameSize, width, height, output_format } = req.body || {};
        if (!model)
            throw new errorHandler_1.ApiError('model is required', 400);
        // Pricing rules (simple first-cut using creditsPerGeneration from matrix)
        const basePerImage = bflutils_1.bflutils.getCreditsPerImage(model);
        if (basePerImage == null)
            throw new errorHandler_1.ApiError('Unsupported model', 400);
        const count = Math.max(1, Math.min(10, Number(n)));
        // Charge solely by model and count
        const cost = Math.ceil(basePerImage * count);
        const { creditBalance } = await ensureUserInit(uid);
        logger_1.logger.info({ uid, model, n: count, cost, creditBalance }, '[CREDITS] Pre-check: computed cost and current balance');
        if (creditBalance < cost) {
            return res.status(402).json({
                responseStatus: 'error',
                message: 'Payment Required',
                data: {
                    requiredCredits: cost,
                    currentBalance: creditBalance,
                    suggestion: 'Buy plan or reduce n/size',
                },
            });
        }
        const idempotencyKey = (0, uuid_1.v4)();
        req.context = {
            creditCost: cost,
            reason: 'bfl.generate',
            idempotencyKey,
            pricingVersion: creditDistribution_1.PRICING_VERSION,
            meta: { model, n: count, frameSize, width, height, output_format },
        };
        logger_1.logger.info({ uid, idempotencyKey, cost }, '[CREDITS] Pre-authorized (post-charge on success)');
        return next();
    }
    catch (err) {
        logger_1.logger.error({ err }, '[CREDITS] creditCost middleware error');
        return next(err);
    }
}
