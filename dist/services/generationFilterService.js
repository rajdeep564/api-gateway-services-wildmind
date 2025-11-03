"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generationFilterService = void 0;
const generationHistoryRepository_1 = require("../repository/generationHistoryRepository");
const publicGenerationsRepository_1 = require("../repository/publicGenerationsRepository");
async function getUserGenerations(uid, params) {
    const limit = params.limit || 20;
    // Support both cursor and page-based pagination
    let cursor = params.cursor;
    if (params.page && !cursor) {
        // For page-based pagination, we need to simulate with cursor
        // This is a simplified approach - for production, consider using offset-based pagination
        cursor = undefined; // Start from beginning for now
    }
    const result = await generationHistoryRepository_1.generationHistoryRepository.list(uid, {
        limit,
        cursor,
        generationType: params.generationType,
        status: params.status,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder,
        dateStart: params.dateStart,
        dateEnd: params.dateEnd,
    });
    const meta = {
        limit,
        nextCursor: result.nextCursor,
        totalCount: result.totalCount,
        hasMore: !!result.nextCursor,
    };
    return {
        items: result.items,
        meta,
    };
}
async function getPublicGenerations(params) {
    let cursor = params.cursor;
    if (params.page && !cursor) {
        cursor = undefined;
    }
    // Support feature-wise mode mapping to generationType arrays
    if (!params.generationType && params.mode) {
        const mode = String(params.mode).toLowerCase();
        if (mode === 'video') {
            params.generationType = ['text-to-video', 'image-to-video', 'video-to-video'];
        }
        else if (mode === 'image') {
            params.generationType = ['text-to-image', 'logo', 'sticker-generation', 'product-generation', 'ad-generation'];
        }
        else if (mode === 'music') {
            params.generationType = ['text-to-music'];
        }
        else if (mode === 'all') {
            params.generationType = undefined;
        }
    }
    const limit = params.limit || 20;
    const result = await publicGenerationsRepository_1.publicGenerationsRepository.listPublic({
        limit,
        cursor,
        generationType: params.generationType,
        status: params.status,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder,
        createdBy: params.createdBy,
        dateStart: params.dateStart,
        dateEnd: params.dateEnd,
        mode: params.mode,
    });
    const meta = {
        limit,
        nextCursor: result.nextCursor,
        totalCount: result.totalCount,
        hasMore: !!result.nextCursor,
    };
    return { items: result.items, meta };
}
async function validateAndTransformParams(queryParams) {
    const params = {};
    // Handle limit
    if (queryParams.limit) {
        const limit = parseInt(queryParams.limit, 10);
        if (isNaN(limit) || limit < 1 || limit > 100) {
            throw new Error('Limit must be between 1 and 100');
        }
        params.limit = limit;
    }
    // Handle page
    if (queryParams.page) {
        const page = parseInt(queryParams.page, 10);
        if (isNaN(page) || page < 1) {
            throw new Error('Page must be a positive integer');
        }
        params.page = page;
    }
    // Handle cursor
    if (queryParams.cursor) {
        params.cursor = queryParams.cursor;
    }
    // Handle generationType
    const validGenerationTypes = [
        'text-to-image', 'logo', 'sticker-generation', 'text-to-video', 'text-to-music',
        'mockup-generation', 'product-generation', 'ad-generation', 'live-chat'
    ];
    if (queryParams.generationType) {
        const raw = queryParams.generationType;
        if (Array.isArray(raw)) {
            const invalid = raw.filter((t) => !validGenerationTypes.includes(String(t)));
            if (invalid.length)
                throw new Error(`Invalid generationType values: ${invalid.join(', ')}`);
            params.generationType = raw.map(String);
        }
        else if (typeof raw === 'string' && raw.includes(',')) {
            const arr = raw.split(',').map(s => s.trim()).filter(Boolean);
            const invalid = arr.filter((t) => !validGenerationTypes.includes(String(t)));
            if (invalid.length)
                throw new Error(`Invalid generationType values: ${invalid.join(', ')}`);
            params.generationType = arr;
        }
        else if (validGenerationTypes.includes(raw)) {
            params.generationType = raw;
        }
        else {
            throw new Error(`Invalid generationType. Must be one of: ${validGenerationTypes.join(', ')}`);
        }
    }
    // Handle status
    const validStatuses = ['generating', 'completed', 'failed'];
    if (queryParams.status) {
        if (validStatuses.includes(queryParams.status)) {
            params.status = queryParams.status;
        }
        else {
            throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
        }
    }
    // Handle sortBy
    const validSortFields = ['createdAt', 'updatedAt', 'prompt'];
    if (queryParams.sortBy) {
        if (validSortFields.includes(queryParams.sortBy)) {
            params.sortBy = queryParams.sortBy;
        }
        else {
            throw new Error(`Invalid sortBy. Must be one of: ${validSortFields.join(', ')}`);
        }
    }
    // Handle sortOrder
    const validSortOrders = ['asc', 'desc'];
    if (queryParams.sortOrder) {
        if (validSortOrders.includes(queryParams.sortOrder)) {
            params.sortOrder = queryParams.sortOrder;
        }
        else {
            throw new Error(`Invalid sortOrder. Must be one of: ${validSortOrders.join(', ')}`);
        }
    }
    // Handle createdBy
    if (queryParams.createdBy) {
        params.createdBy = queryParams.createdBy;
    }
    // Handle mode (feature-wise)
    if (queryParams.mode) {
        const mode = String(queryParams.mode).toLowerCase();
        const validModes = ['video', 'image', 'music', 'all'];
        if (!validModes.includes(mode)) {
            throw new Error(`Invalid mode. Must be one of: ${validModes.join(', ')}`);
        }
        params.mode = mode;
    }
    // Handle date range (ISO strings)
    if (queryParams.dateStart) {
        const d = new Date(queryParams.dateStart);
        if (isNaN(d.getTime()))
            throw new Error('Invalid dateStart');
        params.dateStart = d.toISOString();
    }
    if (queryParams.dateEnd) {
        const d = new Date(queryParams.dateEnd);
        if (isNaN(d.getTime()))
            throw new Error('Invalid dateEnd');
        params.dateEnd = d.toISOString();
    }
    return params;
}
exports.generationFilterService = {
    getUserGenerations,
    getPublicGenerations,
    validateAndTransformParams,
};
