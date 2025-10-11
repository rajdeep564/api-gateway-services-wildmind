"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatApiResponse = formatApiResponse;
function formatApiResponse(responseStatus, message, data, pagination) {
    return {
        responseStatus,
        message,
        data,
        ...(pagination ? { pagination } : {}),
    };
}
