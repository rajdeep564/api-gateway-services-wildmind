"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.creditsController = void 0;
const creditsRepository_1 = require("../repository/creditsRepository");
const formatApiResponse_1 = require("../utils/formatApiResponse");
async function me(req, res, next) {
    try {
        const uid = req.uid;
        const info = await creditsRepository_1.creditsRepository.readUserInfo(uid);
        const recentLedgers = await creditsRepository_1.creditsRepository.listRecentLedgers(uid, 10);
        return res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Credits fetched', {
            planCode: info?.planCode || 'FREE',
            creditBalance: info?.creditBalance || 0,
            recentLedgers,
        }));
    }
    catch (err) {
        next(err);
    }
}
exports.creditsController = { me };
