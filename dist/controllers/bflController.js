"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bflController = void 0;
require("../types/http");
const bflService_1 = require("../services/bflService");
const formatApiResponse_1 = require("../utils/formatApiResponse");
const creditsRepository_1 = require("../repository/creditsRepository");
const logger_1 = require("../utils/logger");
async function generate(req, res, next) {
    try {
        const { prompt, userPrompt, model, n, frameSize, style, uploadedImages, width, height, generationType, tags, nsfw, visibility, isPublic } = req.body || {};
        const uid = req.uid;
        const ctx = req.context || {};
        logger_1.logger.info({ uid, ctx }, '[CREDITS] Enter generate controller with context');
        const result = await bflService_1.bflService.generate(uid, { prompt, userPrompt, model, n, frameSize, style, uploadedImages, width, height, generationType, tags, nsfw, visibility, isPublic });
        let debitOutcome;
        try {
            const requestId = result.historyId || ctx.idempotencyKey;
            logger_1.logger.info({ uid, requestId, cost: ctx.creditCost }, '[CREDITS] Attempt debit after success');
            if (requestId && typeof ctx.creditCost === 'number') {
                debitOutcome = await creditsRepository_1.creditsRepository.writeDebitIfAbsent(uid, requestId, ctx.creditCost, ctx.reason || 'bfl.generate', {
                    ...(ctx.meta || {}),
                    historyId: result.historyId,
                    provider: 'bfl',
                    pricingVersion: ctx.pricingVersion,
                });
                logger_1.logger.info({ uid, requestId, debitOutcome }, '[CREDITS] Debit result');
            }
        }
        catch (_e) { }
        res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Images generated', {
            ...result,
            debitedCredits: typeof ctx.creditCost === 'number' ? ctx.creditCost : undefined,
            debitStatus: debitOutcome,
        }));
    }
    catch (err) {
        logger_1.logger.error({ err }, '[CREDITS] Generate controller error');
        next(err);
    }
}
async function fill(req, res, next) {
    try {
        const uid = req.uid;
        const ctx = req.context || {};
        logger_1.logger.info({ uid, ctx }, '[CREDITS] Enter fill controller with context');
        const result = await bflService_1.bflService.fill(uid, req.body);
        let debitOutcomeFill;
        try {
            const requestId = result.historyId || ctx.idempotencyKey;
            logger_1.logger.info({ uid, requestId, cost: ctx.creditCost }, '[CREDITS] Attempt debit after fill success');
            if (requestId && typeof ctx.creditCost === 'number') {
                debitOutcomeFill = await creditsRepository_1.creditsRepository.writeDebitIfAbsent(uid, requestId, ctx.creditCost, ctx.reason || 'bfl.fill', {
                    ...(ctx.meta || {}),
                    historyId: result.historyId,
                    provider: 'bfl',
                    pricingVersion: ctx.pricingVersion,
                });
                logger_1.logger.info({ uid, requestId, debitOutcomeFill }, '[CREDITS] Debit result (fill)');
            }
        }
        catch (_e) { }
        res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Image filled', { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcomeFill }));
    }
    catch (err) {
        logger_1.logger.error({ err }, '[CREDITS] Fill controller error');
        next(err);
    }
}
async function expand(req, res, next) {
    try {
        const uid = req.uid;
        const ctx = req.context || {};
        logger_1.logger.info({ uid, ctx }, '[CREDITS] Enter expand controller with context');
        const result = await bflService_1.bflService.expand(uid, req.body);
        let debitOutcomeExpand;
        try {
            const requestId = result.historyId || ctx.idempotencyKey;
            logger_1.logger.info({ uid, requestId, cost: ctx.creditCost }, '[CREDITS] Attempt debit after expand success');
            if (requestId && typeof ctx.creditCost === 'number') {
                debitOutcomeExpand = await creditsRepository_1.creditsRepository.writeDebitIfAbsent(uid, requestId, ctx.creditCost, ctx.reason || 'bfl.expand', {
                    ...(ctx.meta || {}),
                    historyId: result.historyId,
                    provider: 'bfl',
                    pricingVersion: ctx.pricingVersion,
                });
                logger_1.logger.info({ uid, requestId, debitOutcomeExpand }, '[CREDITS] Debit result (expand)');
            }
        }
        catch (_e) { }
        res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Image expanded', { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcomeExpand }));
    }
    catch (err) {
        logger_1.logger.error({ err }, '[CREDITS] Expand controller error');
        next(err);
    }
}
async function canny(req, res, next) {
    try {
        const uid = req.uid;
        const ctx = req.context || {};
        logger_1.logger.info({ uid, ctx }, '[CREDITS] Enter canny controller with context');
        const result = await bflService_1.bflService.canny(uid, req.body);
        let debitOutcomeCanny;
        try {
            const requestId = result.historyId || ctx.idempotencyKey;
            logger_1.logger.info({ uid, requestId, cost: ctx.creditCost }, '[CREDITS] Attempt debit after canny success');
            if (requestId && typeof ctx.creditCost === 'number') {
                debitOutcomeCanny = await creditsRepository_1.creditsRepository.writeDebitIfAbsent(uid, requestId, ctx.creditCost, ctx.reason || 'bfl.canny', {
                    ...(ctx.meta || {}),
                    historyId: result.historyId,
                    provider: 'bfl',
                    pricingVersion: ctx.pricingVersion,
                });
                logger_1.logger.info({ uid, requestId, debitOutcomeCanny }, '[CREDITS] Debit result (canny)');
            }
        }
        catch (_e) { }
        res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Image generated (canny)', { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcomeCanny }));
    }
    catch (err) {
        logger_1.logger.error({ err }, '[CREDITS] Canny controller error');
        next(err);
    }
}
async function depth(req, res, next) {
    try {
        const uid = req.uid;
        const ctx = req.context || {};
        logger_1.logger.info({ uid, ctx }, '[CREDITS] Enter depth controller with context');
        const result = await bflService_1.bflService.depth(uid, req.body);
        let debitOutcomeDepth;
        try {
            const requestId = result.historyId || ctx.idempotencyKey;
            logger_1.logger.info({ uid, requestId, cost: ctx.creditCost }, '[CREDITS] Attempt debit after depth success');
            if (requestId && typeof ctx.creditCost === 'number') {
                debitOutcomeDepth = await creditsRepository_1.creditsRepository.writeDebitIfAbsent(uid, requestId, ctx.creditCost, ctx.reason || 'bfl.depth', {
                    ...(ctx.meta || {}),
                    historyId: result.historyId,
                    provider: 'bfl',
                    pricingVersion: ctx.pricingVersion,
                });
                logger_1.logger.info({ uid, requestId, debitOutcomeDepth }, '[CREDITS] Debit result (depth)');
            }
        }
        catch (_e) { }
        res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Image generated (depth)', { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcomeDepth }));
    }
    catch (err) {
        logger_1.logger.error({ err }, '[CREDITS] Depth controller error');
        next(err);
    }
}
async function expandWithFill(req, res, next) {
    try {
        const uid = req.uid;
        const ctx = req.context || {};
        logger_1.logger.info({ uid, ctx }, '[CREDITS] Enter expandWithFill controller with context');
        const result = await bflService_1.bflService.expandWithFill(uid, req.body);
        let debitOutcome;
        try {
            const requestId = result.historyId || ctx.idempotencyKey;
            logger_1.logger.info({ uid, requestId, cost: ctx.creditCost }, '[CREDITS] Attempt debit after expandWithFill success');
            if (requestId && typeof ctx.creditCost === 'number') {
                debitOutcome = await creditsRepository_1.creditsRepository.writeDebitIfAbsent(uid, requestId, ctx.creditCost, ctx.reason || 'bfl.expandWithFill', {
                    ...(ctx.meta || {}),
                    historyId: result.historyId,
                    provider: 'bfl',
                    pricingVersion: ctx.pricingVersion,
                });
                logger_1.logger.info({ uid, requestId, debitOutcome }, '[CREDITS] Debit result (expandWithFill)');
            }
        }
        catch (_e) { }
        res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Image expanded with FLUX Fill', { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcome }));
    }
    catch (err) {
        logger_1.logger.error({ err }, '[CREDITS] ExpandWithFill controller error');
        next(err);
    }
}
exports.bflController = {
    generate,
    fill,
    expand,
    expandWithFill,
    canny,
    depth,
};
