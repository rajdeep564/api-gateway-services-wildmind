import { Request, Response, NextFunction } from 'express';
import { validationResult, body, query } from 'express-validator';
import { ApiError } from '../utils/errorHandler';

export const validateSession = [
  body('idToken').isString().notEmpty().withMessage('idToken is required'),
  (req: Request, _res: Response, next: NextFunction) => {
    console.log('[VALIDATION][validateSession] Request received', {
      hasIdToken: !!req.body?.idToken,
      idTokenLength: req.body?.idToken?.length || 0,
      origin: req.headers.origin,
      method: req.method,
      path: req.path
    });
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('[VALIDATION][validateSession] Validation failed', errors.array());
      return next(new ApiError('Validation failed', 400, errors.array()));
    }
    console.log('[VALIDATION][validateSession] Validation passed, calling next()');
    next();
  }
];

export const validateOtpStart = [
  body('email').isEmail().withMessage('Valid email is required'),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ApiError('Validation failed', 400, errors.array()));
    }
    next();
  }
];

export const validateOtpVerify = [
  body('email').isEmail().withMessage('Valid email is required'),
  body('code').optional().isLength({ min: 6, max: 6 }).isNumeric().withMessage('Code must be 6 digits'),
  body('otp').optional().isLength({ min: 6, max: 6 }).isNumeric().withMessage('OTP must be 6 digits'),
  body('password').optional({ values: 'falsy' }).isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  (req: Request, _res: Response, next: NextFunction) => {
    console.log(`[VALIDATION] OTP Verify - Body:`, req.body);
    
    // Normalize otp to code if needed
    if (req.body.otp && !req.body.code) {
      req.body.code = req.body.otp;
      console.log(`[VALIDATION] Normalized otp to code: ${req.body.code}`);
    }
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log(`[VALIDATION] OTP Verify validation errors:`, errors.array());
      return next(new ApiError('Validation failed', 400, errors.array()));
    }
    console.log(`[VALIDATION] OTP Verify validation passed`);
    next();
  }
];

export const validateUsername = [
  body('username').isLength({ min: 3, max: 30 }).matches(/^[a-z0-9_.-]+$/).withMessage('Username must be 3-30 chars: a-z0-9_.-'),
  body('email').isEmail().withMessage('Valid email is required'),
  (req: Request, _res: Response, next: NextFunction) => {
    console.log(`[VALIDATION] Username - Body:`, req.body);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log(`[VALIDATION] Username validation errors:`, errors.array());
      return next(new ApiError('Validation failed', 400, errors.array()));
    }
    console.log(`[VALIDATION] Username validation passed`);
    next();
  }
];

export const validateUpdateMe = [
  body('username').optional().isLength({ min: 3, max: 30 }).matches(/^[a-z0-9_.-]+$/).withMessage('Username must be 3-30 chars: a-z0-9_.-'),
  body('photoURL').optional().isURL().withMessage('PhotoURL must be a valid URL'),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ApiError('Validation failed', 400, errors.array()));
    }
    next();
  }
];

export const validateLogin = [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  (req: Request, _res: Response, next: NextFunction) => {
    console.log(`[VALIDATION] Login - Body:`, req.body);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log(`[VALIDATION] Login validation errors:`, errors.array());
      return next(new ApiError('Validation failed', 400, errors.array()));
    }
    console.log(`[VALIDATION] Login validation passed`);
    next();
  }
];

export const validateGoogleSignIn = [
  body('idToken').notEmpty().withMessage('Google ID token is required'),
  (req: Request, _res: Response, next: NextFunction) => {
    console.log(`[VALIDATION] Google sign-in - Body:`, req.body);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log(`[VALIDATION] Google sign-in validation errors:`, errors.array());
      return next(new ApiError('Validation failed', 400, errors.array()));
    }
    console.log(`[VALIDATION] Google sign-in validation passed`);
    next();
  }
];

export const validateGoogleUsername = [
  body('uid').notEmpty().withMessage('User UID is required'),
  body('username').isLength({ min: 3, max: 30 }).matches(/^[a-z0-9_.-]+$/).withMessage('Username must be 3-30 chars: a-z0-9_.-'),
  (req: Request, _res: Response, next: NextFunction) => {
    console.log(`[VALIDATION] Google username - Body:`, req.body);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log(`[VALIDATION] Google username validation errors:`, errors.array());
      return next(new ApiError('Validation failed', 400, errors.array()));
    }
    console.log(`[VALIDATION] Google username validation passed`);
    next();
  }
];

export const validateCheckUsername = [
  query('username')
    .isString()
    .trim()
    .isLength({ min: 3, max: 30 })
    .matches(/^[a-z0-9_.-]+$/)
    .withMessage('Username must be 3-30 chars: a-z0-9_.-'),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ApiError('Validation failed', 400, errors.array()));
    }
    next();
  }
];
