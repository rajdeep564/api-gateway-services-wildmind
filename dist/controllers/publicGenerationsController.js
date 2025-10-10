"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicGenerationsController = void 0;
const generationFilterService_1 = require("../services/generationFilterService");
const publicGenerationsRepository_1 = require("../repository/publicGenerationsRepository");
const formatApiResponse_1 = require("../utils/formatApiResponse");
async function listPublic(req, res, next) {
    try {
        const params = await generationFilterService_1.generationFilterService.validateAndTransformParams(req.query);
        const result = await generationFilterService_1.generationFilterService.getPublicGenerations(params);
        return res.json((0, formatApiResponse_1.formatApiResponse)('success', 'OK', result));
    }
    catch (err) {
        return next(err);
    }
}
async function getPublicById(req, res, next) {
    try {
        const { generationId } = req.params;
        const item = await publicGenerationsRepository_1.publicGenerationsRepository.getPublicById(generationId);
        if (!item)
            return res.status(404).json((0, formatApiResponse_1.formatApiResponse)('error', 'Not found', {}));
        return res.json((0, formatApiResponse_1.formatApiResponse)('success', 'OK', { item }));
    }
    catch (err) {
        return next(err);
    }
}
exports.publicGenerationsController = {
    listPublic,
    getPublicById,
};
