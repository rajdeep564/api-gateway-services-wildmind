"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeCreditCost = makeCreditCost;
const errorHandler_1 = require("../utils/errorHandler");
const creditsService_1 = require("../services/creditsService");
const uuid_1 = require("uuid");
const creditsRepository_1 = require("../repository/creditsRepository");
function makeCreditCost(provider, operation, computeCost) {
    return async (req, res, next) => {
        try {
            const uid = req.uid;
            if (!uid)
                throw new errorHandler_1.ApiError('Unauthorized', 401);
            const { cost, pricingVersion, meta } = await computeCost(req);
            // Ensure user doc exists then perform monthly reroll (idempotent)
            await creditsService_1.creditsService.ensureUserInit(uid);
            await creditsService_1.creditsService.ensureMonthlyReroll(uid);
            const creditBalance = await creditsRepository_1.creditsRepository.readUserCredits(uid);
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
                reason: `${provider}.${operation}`,
                idempotencyKey,
                pricingVersion,
                meta,
            };
            next();
        }
        catch (e) {
            next(e);
        }
    };
}
