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
