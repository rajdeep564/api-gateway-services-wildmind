import { Request, Response, NextFunction } from 'express';
import { validationResult, body, query } from 'express-validator';
import { ApiError } from '../utils/errorHandler';
import { validateEmail } from '../utils/emailValidator';

function normalizeForPasswordComparison(value?: string): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function passwordContainsUsername(password?: string, username?: string): boolean {
  const normalizedUsername = normalizeForPasswordComparison(username);
  if (normalizedUsername.length < 3) {
    return false;
  }

  return normalizeForPasswordComparison(password).includes(normalizedUsername);
}

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
  async (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ApiError('Validation failed', 400, errors.array()));
    }
    
    // Additional email validation: check for temporary emails and MX records
    try {
      const email = req.body?.email;
      if (email) {
        await validateEmail(email);
      }
    } catch (error: any) {
      // If it's an ApiError, pass it through; otherwise wrap it
      if (error instanceof ApiError) {
        return next(error);
      }
      return next(new ApiError(error.message || 'Email validation failed', 400));
    }
    
    next();
  }
];

export const validateOtpVerify = [
  body('email').isEmail().withMessage('Valid email is required'),
  body('code').optional().isLength({ min: 6, max: 6 }).isNumeric().withMessage('Code must be 6 digits'),
  body('otp').optional().isLength({ min: 6, max: 6 }).isNumeric().withMessage('OTP must be 6 digits'),
  body('password').optional({ values: 'falsy' }).isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('username')
    .optional({ values: 'falsy' })
    .isLength({ min: 3, max: 30 })
    .matches(/^[a-z0-9_.-]+$/)
    .withMessage('Username must be 3-30 chars: a-z0-9_.-'),
  body('password').custom((password, { req }) => {
    if (!password || !req.body?.username) {
      return true;
    }

    if (passwordContainsUsername(password, req.body.username)) {
      throw new Error('Password must not contain your username.');
    }

    return true;
  }),
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
  body('preferredCurrency')
    .optional()
    .isLength({ min: 3, max: 3 })
    .matches(/^[A-Z]{3}$/)
    .withMessage('preferredCurrency must be a 3-letter ISO 4217 code (e.g. USD, EUR)'),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ApiError('Validation failed', 400, errors.array()));
    }
    next();
  }
];

export const validateLogin = [
  body('identifier')
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Email or username is required'),
  body('email')
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Email or username is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body().custom((_, { req }) => {
    const identifier = String(req.body?.identifier || req.body?.email || '').trim();
    if (!identifier) {
      throw new Error('Email or username is required');
    }
    return true;
  }),
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.body?.identifier && req.body?.email) {
      req.body.identifier = req.body.email;
    }

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

export const validateForgotPassword = [
  body('email').isEmail().withMessage('Valid email is required'),
  async (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log(`[VALIDATION] Forgot password validation errors:`, errors.array());
      return next(new ApiError('Validation failed', 400, errors.array()));
    }
    
    // Additional email validation: check for temporary emails and MX records
    try {
      const email = req.body?.email;
      if (email) {
        await validateEmail(email);
      }
    } catch (error: any) {
      console.log(`[VALIDATION] Forgot password email validation failed:`, error.message);
      return next(new ApiError(error.message || 'Invalid email address', 400));
    }
    
    console.log(`[VALIDATION] Forgot password validation passed`);
    next();
  }
];

export const validateCompleteResetPassword = [
  body('oobCode').isString().notEmpty().withMessage('Reset code is required'),
  body('expiresAt')
    .isInt({ min: 1 })
    .withMessage('Reset link expiry is required'),
  body('signature')
    .isString()
    .notEmpty()
    .withMessage('Reset link signature is required'),
  body('newPassword')
    .isString()
    .isLength({ min: 8, max: 14 })
    .withMessage('Password must be 8-14 characters')
    .matches(/[A-Z]/)
    .withMessage('Password must contain at least 1 uppercase letter')
    .matches(/[a-z]/)
    .withMessage('Password must contain at least 1 lowercase letter')
    .matches(/[0-9]/)
    .withMessage('Password must contain at least 1 number')
    .matches(/[^A-Za-z0-9]/)
    .withMessage('Password must contain at least 1 special character'),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ApiError('Validation failed', 400, errors.array()));
    }
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
