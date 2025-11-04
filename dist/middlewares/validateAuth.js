"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateCheckUsername = exports.validateGoogleUsername = exports.validateGoogleSignIn = exports.validateLogin = exports.validateUpdateMe = exports.validateUsername = exports.validateOtpVerify = exports.validateOtpStart = exports.validateSession = void 0;
const express_validator_1 = require("express-validator");
const errorHandler_1 = require("../utils/errorHandler");
exports.validateSession = [
    (0, express_validator_1.body)('idToken').isString().notEmpty().withMessage('idToken is required'),
    (req, _res, next) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        }
        next();
    }
];
exports.validateOtpStart = [
    (0, express_validator_1.body)('email').isEmail().withMessage('Valid email is required'),
    (req, _res, next) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        }
        next();
    }
];
exports.validateOtpVerify = [
    (0, express_validator_1.body)('email').isEmail().withMessage('Valid email is required'),
    (0, express_validator_1.body)('code').optional().isLength({ min: 6, max: 6 }).isNumeric().withMessage('Code must be 6 digits'),
    (0, express_validator_1.body)('otp').optional().isLength({ min: 6, max: 6 }).isNumeric().withMessage('OTP must be 6 digits'),
    (0, express_validator_1.body)('password').optional({ values: 'falsy' }).isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    (req, _res, next) => {
        console.log(`[VALIDATION] OTP Verify - Body:`, req.body);
        // Normalize otp to code if needed
        if (req.body.otp && !req.body.code) {
            req.body.code = req.body.otp;
            console.log(`[VALIDATION] Normalized otp to code: ${req.body.code}`);
        }
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            console.log(`[VALIDATION] OTP Verify validation errors:`, errors.array());
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        }
        console.log(`[VALIDATION] OTP Verify validation passed`);
        next();
    }
];
exports.validateUsername = [
    (0, express_validator_1.body)('username').isLength({ min: 3, max: 30 }).matches(/^[a-z0-9_.-]+$/).withMessage('Username must be 3-30 chars: a-z0-9_.-'),
    (0, express_validator_1.body)('email').isEmail().withMessage('Valid email is required'),
    (req, _res, next) => {
        console.log(`[VALIDATION] Username - Body:`, req.body);
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            console.log(`[VALIDATION] Username validation errors:`, errors.array());
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        }
        console.log(`[VALIDATION] Username validation passed`);
        next();
    }
];
exports.validateUpdateMe = [
    (0, express_validator_1.body)('username').optional().isLength({ min: 3, max: 30 }).matches(/^[a-z0-9_.-]+$/).withMessage('Username must be 3-30 chars: a-z0-9_.-'),
    (0, express_validator_1.body)('photoURL').optional().isURL().withMessage('PhotoURL must be a valid URL'),
    (req, _res, next) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        }
        next();
    }
];
exports.validateLogin = [
    (0, express_validator_1.body)('email').isEmail().withMessage('Valid email is required'),
    (0, express_validator_1.body)('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    (req, _res, next) => {
        console.log(`[VALIDATION] Login - Body:`, req.body);
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            console.log(`[VALIDATION] Login validation errors:`, errors.array());
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        }
        console.log(`[VALIDATION] Login validation passed`);
        next();
    }
];
exports.validateGoogleSignIn = [
    (0, express_validator_1.body)('idToken').notEmpty().withMessage('Google ID token is required'),
    (req, _res, next) => {
        console.log(`[VALIDATION] Google sign-in - Body:`, req.body);
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            console.log(`[VALIDATION] Google sign-in validation errors:`, errors.array());
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        }
        console.log(`[VALIDATION] Google sign-in validation passed`);
        next();
    }
];
exports.validateGoogleUsername = [
    (0, express_validator_1.body)('uid').notEmpty().withMessage('User UID is required'),
    (0, express_validator_1.body)('username').isLength({ min: 3, max: 30 }).matches(/^[a-z0-9_.-]+$/).withMessage('Username must be 3-30 chars: a-z0-9_.-'),
    (req, _res, next) => {
        console.log(`[VALIDATION] Google username - Body:`, req.body);
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            console.log(`[VALIDATION] Google username validation errors:`, errors.array());
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        }
        console.log(`[VALIDATION] Google username validation passed`);
        next();
    }
];
exports.validateCheckUsername = [
    (0, express_validator_1.query)('username')
        .isString()
        .trim()
        .isLength({ min: 3, max: 30 })
        .matches(/^[a-z0-9_.-]+$/)
        .withMessage('Username must be 3-30 chars: a-z0-9_.-'),
    (req, _res, next) => {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return next(new errorHandler_1.ApiError('Validation failed', 400, errors.array()));
        }
        next();
    }
];
