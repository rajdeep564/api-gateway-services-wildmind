"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.falController = void 0;
require("../types/http");
const formatApiResponse_1 = require("../utils/formatApiResponse");
const falService_1 = require("../services/falService");
const creditsRepository_1 = require("../repository/creditsRepository");
const logger_1 = require("../utils/logger");
async function generate(req, res, next) {
    try {
        const { prompt, userPrompt, model, n, frameSize, style, uploadedImages, output_format, generationType, tags, nsfw, visibility, isPublic, aspect_ratio, num_images, resolution, seed, negative_prompt } = req.body || {};
        const uid = req.uid;
        const ctx = req.context || {};
        logger_1.logger.info({ uid, ctx }, '[CREDITS][FAL] Enter generate with context');
        const result = await falService_1.falService.generate(uid, { num_images, prompt, userPrompt, model, n, frameSize, style, uploadedImages, output_format, generationType, tags, nsfw, visibility, isPublic, aspect_ratio, resolution, seed, negative_prompt });
        let debitOutcome;
        try {
            const requestId = result.historyId || ctx.idempotencyKey;
            logger_1.logger.info({ uid, requestId, cost: ctx.creditCost }, '[CREDITS][FAL] Attempt debit after success');
            if (requestId && typeof ctx.creditCost === 'number') {
                debitOutcome = await creditsRepository_1.creditsRepository.writeDebitIfAbsent(uid, requestId, ctx.creditCost, ctx.reason || 'fal.generate', {
                    ...(ctx.meta || {}),
                    historyId: result.historyId,
                    provider: 'fal',
                    pricingVersion: ctx.pricingVersion,
                });
            }
        }
        catch (_e) { }
        res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Images generated', { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcome }));
    }
    catch (err) {
        next(err);
    }
}
exports.falController = {
    generate,
    // Queue
    async veoTtvSubmit(req, res, next) {
        try {
            const uid = req.uid;
            const ctx = req.context || {};
            const result = await falService_1.falQueueService.veoTtvSubmit(uid, req.body || {}, false);
            res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
        }
        catch (err) {
            next(err);
        }
    },
    async veoTtvFastSubmit(req, res, next) {
        try {
            const uid = req.uid;
            const ctx = req.context || {};
            const result = await falService_1.falQueueService.veoTtvSubmit(uid, req.body || {}, true);
            res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
        }
        catch (err) {
            next(err);
        }
    },
    async veo31TtvSubmit(req, res, next) {
        try {
            const uid = req.uid;
            const ctx = req.context || {};
            const result = await falService_1.falQueueService.veo31TtvSubmit(uid, req.body || {}, false);
            res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
        }
        catch (err) {
            next(err);
        }
    },
    async veo31TtvFastSubmit(req, res, next) {
        try {
            const uid = req.uid;
            const ctx = req.context || {};
            const result = await falService_1.falQueueService.veo31TtvSubmit(uid, req.body || {}, true);
            res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
        }
        catch (err) {
            next(err);
        }
    },
    async veoI2vSubmit(req, res, next) {
        try {
            const uid = req.uid;
            const ctx = req.context || {};
            const result = await falService_1.falQueueService.veoI2vSubmit(uid, req.body || {}, false);
            res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
        }
        catch (err) {
            next(err);
        }
    },
    async veo31I2vSubmit(req, res, next) {
        try {
            const uid = req.uid;
            const ctx = req.context || {};
            const result = await falService_1.falQueueService.veo31I2vSubmit(uid, req.body || {}, false);
            res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
        }
        catch (err) {
            next(err);
        }
    },
    async veo31I2vFastSubmit(req, res, next) {
        try {
            const uid = req.uid;
            const ctx = req.context || {};
            const result = await falService_1.falQueueService.veo31I2vSubmit(uid, req.body || {}, true);
            res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
        }
        catch (err) {
            next(err);
        }
    },
    async veo31FirstLastFastSubmit(req, res, next) {
        try {
            const uid = req.uid;
            const ctx = req.context || {};
            const result = await falService_1.falQueueService.veo31FirstLastFastSubmit(uid, req.body || {});
            res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
        }
        catch (err) {
            next(err);
        }
    },
    async veo31ReferenceToVideoSubmit(req, res, next) {
        try {
            const uid = req.uid;
            const ctx = req.context || {};
            const result = await falService_1.falQueueService.veo31ReferenceToVideoSubmit(uid, req.body || {});
            res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
        }
        catch (err) {
            next(err);
        }
    },
    async veo31FirstLastSubmit(req, res, next) {
        try {
            const uid = req.uid;
            const ctx = req.context || {};
            const result = await falService_1.falQueueService.veo31FirstLastSubmit(uid, req.body || {});
            res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
        }
        catch (err) {
            next(err);
        }
    },
    async sora2I2vSubmit(req, res, next) {
        try {
            const uid = req.uid;
            const ctx = req.context || {};
            const result = await falService_1.falQueueService.sora2I2vSubmit(uid, req.body || {});
            res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
        }
        catch (err) {
            next(err);
        }
    },
    async sora2ProI2vSubmit(req, res, next) {
        try {
            const uid = req.uid;
            const ctx = req.context || {};
            const result = await falService_1.falQueueService.sora2ProI2vSubmit(uid, req.body || {});
            res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
        }
        catch (err) {
            next(err);
        }
    },
    async sora2T2vSubmit(req, res, next) {
        try {
            const uid = req.uid;
            const ctx = req.context || {};
            const result = await falService_1.falQueueService.sora2T2vSubmit(uid, req.body || {});
            res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
        }
        catch (err) {
            next(err);
        }
    },
    async sora2ProT2vSubmit(req, res, next) {
        try {
            const uid = req.uid;
            const ctx = req.context || {};
            const result = await falService_1.falQueueService.sora2ProT2vSubmit(uid, req.body || {});
            res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
        }
        catch (err) {
            next(err);
        }
    },
    async sora2RemixV2vSubmit(req, res, next) {
        try {
            const uid = req.uid;
            const ctx = req.context || {};
            const result = await falService_1.falQueueService.sora2RemixV2vSubmit(uid, req.body || {});
            res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
        }
        catch (err) {
            next(err);
        }
    },
    async ltx2ProI2vSubmit(req, res, next) {
        try {
            const uid = req.uid;
            const ctx = req.context || {};
            const result = await falService_1.falQueueService.ltx2ProI2vSubmit(uid, req.body || {});
            res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
        }
        catch (err) {
            next(err);
        }
    },
    async ltx2FastI2vSubmit(req, res, next) {
        try {
            const uid = req.uid;
            const ctx = req.context || {};
            const result = await falService_1.falQueueService.ltx2FastI2vSubmit(uid, req.body || {});
            res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
        }
        catch (err) {
            next(err);
        }
    },
    async ltx2ProT2vSubmit(req, res, next) {
        try {
            const uid = req.uid;
            const ctx = req.context || {};
            const result = await falService_1.falQueueService.ltx2ProT2vSubmit(uid, req.body || {});
            res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
        }
        catch (err) {
            next(err);
        }
    },
    async ltx2FastT2vSubmit(req, res, next) {
        try {
            const uid = req.uid;
            const ctx = req.context || {};
            const result = await falService_1.falQueueService.ltx2FastT2vSubmit(uid, req.body || {});
            res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
        }
        catch (err) {
            next(err);
        }
    },
    async veoI2vFastSubmit(req, res, next) {
        try {
            const uid = req.uid;
            const ctx = req.context || {};
            const result = await falService_1.falQueueService.veoI2vSubmit(uid, req.body || {}, true);
            res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
        }
        catch (err) {
            next(err);
        }
    },
    async queueStatus(req, res, next) {
        try {
            const uid = req.uid;
            const model = req.query.model || req.body?.model;
            const requestId = req.query.requestId || req.body?.requestId;
            const result = await falService_1.falQueueService.queueStatus(uid, model, requestId);
            res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Status', result));
        }
        catch (err) {
            next(err);
        }
    },
    async queueResult(req, res, next) {
        try {
            const uid = req.uid;
            const model = req.query.model || req.body?.model;
            const requestId = req.query.requestId || req.body?.requestId;
            const result = await falService_1.falQueueService.queueResult(uid, model, requestId);
            res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Result', result));
        }
        catch (err) {
            next(err);
        }
    }
};
