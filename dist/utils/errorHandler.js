"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiError = void 0;
exports.errorHandler = errorHandler;
class ApiError extends Error {
    constructor(message, statusCode = 500, data) {
        super(message);
        this.statusCode = statusCode;
        this.data = data;
        Object.setPrototypeOf(this, ApiError.prototype);
    }
}
exports.ApiError = ApiError;
function errorHandler(err, req, res, next) {
    const status = err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    const data = err.data || null;
    res.status(status).json({
        responseStatus: "error",
        message,
        data,
    });
}
