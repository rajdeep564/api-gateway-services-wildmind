"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.minimaxController = void 0;
require("../types/http");
const env_1 = require("../config/env");
const formatApiResponse_1 = require("../utils/formatApiResponse");
const minimaxService_1 = require("../services/minimaxService");
const creditsRepository_1 = require("../repository/creditsRepository");
const logger_1 = require("../utils/logger");
const generationHistoryRepository_1 = require("../repository/generationHistoryRepository");
const authRepository_1 = require("../repository/auth/authRepository");
// Images
async function generate(req, res, next) {
    try {
        const { prompt, aspect_ratio, width, height, response_format, seed, n, prompt_optimizer, subject_reference, generationType, style } = req.body || {};
        const uid = req.uid;
        const ctx = req.context || {};
        logger_1.logger.info({ uid, ctx }, '[CREDITS][MINIMAX] Enter generate with context');
        const result = await minimaxService_1.minimaxService.generate(uid, { prompt, aspect_ratio, width, height, response_format, seed, n, prompt_optimizer, subject_reference, generationType, style });
        let debitOutcome;
        try {
            const requestId = result.historyId || ctx.idempotencyKey;
            logger_1.logger.info({ uid, requestId, cost: ctx.creditCost }, '[CREDITS][MINIMAX] Attempt debit after success');
            if (requestId && typeof ctx.creditCost === 'number') {
                debitOutcome = await creditsRepository_1.creditsRepository.writeDebitIfAbsent(uid, requestId, ctx.creditCost, ctx.reason || 'minimax.generate', {
                    ...(ctx.meta || {}),
                    historyId: result.historyId,
                    provider: 'minimax',
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
// Video
async function videoStart(req, res, next) {
    try {
        const apiKey = env_1.env.minimaxApiKey;
        const groupId = env_1.env.minimaxGroupId;
        const ctx = req.context || {};
        const result = await minimaxService_1.minimaxService.generateVideo(apiKey, groupId, req.body);
        // Create history now so we have a consistent idempotency/debit key and store model params for pricing
        const uid = req.uid;
        const body = req.body || {};
        const creator = await authRepository_1.authRepository.getUserById(uid);
        const prompt = String(body?.prompt || body?.promptText || '');
        const model = String(body?.model || 'MiniMax-Hailuo-02');
        const generationType = body?.generationType || 'text-to-video';
        const { historyId } = await generationHistoryRepository_1.generationHistoryRepository.create(uid, {
            prompt,
            model,
            generationType,
            visibility: body.visibility || 'private',
            tags: body.tags,
            nsfw: body.nsfw,
            isPublic: body.isPublic === true,
            createdBy: { uid, username: creator?.username, email: creator?.email },
        });
        const updates = { provider: 'minimax', providerTaskId: result.taskId };
        if (typeof body?.duration !== 'undefined')
            updates.duration = body.duration;
        if (typeof body?.resolution !== 'undefined')
            updates.resolution = body.resolution;
        await generationHistoryRepository_1.generationHistoryRepository.update(uid, historyId, updates);
        res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Task created', { ...result, historyId, expectedDebit: ctx.creditCost }));
    }
    catch (err) {
        next(err);
    }
}
async function videoStatus(req, res, next) {
    try {
        const apiKey = env_1.env.minimaxApiKey;
        const taskId = String(req.query.task_id || '');
        const result = await minimaxService_1.minimaxService.getVideoStatus(apiKey, taskId);
        res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Status', result));
    }
    catch (err) {
        next(err);
    }
}
async function videoFile(req, res, next) {
    try {
        const fileId = String(req.query.file_id || '');
        const historyId = req.query.history_id ? String(req.query.history_id) : undefined;
        const result = await minimaxService_1.minimaxService.processVideoFile(req.uid, fileId, historyId);
        res.json((0, formatApiResponse_1.formatApiResponse)('success', 'File', result));
    }
    catch (err) {
        next(err);
    }
}
// Music
async function musicGenerate(req, res, next) {
    try {
        const ctx = req.context || {};
        const result = await minimaxService_1.minimaxService.musicGenerateAndStore(req.uid, req.body);
        // musicGenerateAndStore updates history; we'll perform debit here if historyId present
        try {
            const requestId = result.historyId || ctx.idempotencyKey;
            if (requestId && typeof ctx.creditCost === 'number') {
                await creditsRepository_1.creditsRepository.writeDebitIfAbsent(req.uid, requestId, ctx.creditCost, ctx.reason || 'minimax.music', {
                    ...(ctx.meta || {}),
                    historyId: result.historyId,
                    provider: 'minimax',
                    pricingVersion: ctx.pricingVersion,
                });
            }
        }
        catch (_e) { }
        res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Music generated', { ...result, debitedCredits: ctx.creditCost }));
    }
    catch (err) {
        next(err);
    }
}
exports.minimaxController = {
    generate,
    videoStart,
    videoStatus,
    videoFile,
    musicGenerate
};
