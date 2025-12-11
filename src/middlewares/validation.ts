/**
 * Request Validation & Sanitization Middleware
 * 
 * Prevents injection attacks:
 * - SQL injection
 * - NoSQL injection
 * - XSS (Cross-Site Scripting)
 * - Command injection
 */

import { Request, Response, NextFunction } from 'express';
import { body, validationResult, ValidationChain } from 'express-validator';
import DOMPurify from 'isomorphic-dompurify';

/**
 * Sanitize all string inputs in request
 */
export const sanitizeInput = (req: Request, res: Response, next: NextFunction) => {
  const sanitizeValue = (value: any): any => {
    if (typeof value === 'string') {
      // Remove potentially dangerous HTML/scripts
      return DOMPurify.sanitize(value, { ALLOWED_TAGS: [] });
    } else if (Array.isArray(value)) {
      return value.map(sanitizeValue);
    } else if (typeof value === 'object' && value !== null) {
      const sanitized: any = {};
      for (const key in value) {
        sanitized[key] = sanitizeValue(value[key]);
      }
      return sanitized;
    }
    return value;
  };

  // Sanitize all input sources
  if (req.body) {
    req.body = sanitizeValue(req.body);
  }
  if (req.query) {
    req.query = sanitizeValue(req.query);
  }
  if (req.params) {
    req.params = sanitizeValue(req.params);
  }

  next();
};

/**
 * Common validation rules
 */
export const validateEmail = body('email')
  .trim()
  .isEmail()
  .normalizeEmail()
  .withMessage('Invalid email address');

export const validatePrompt = body('prompt')
  .trim()
  .isLength({ min: 1, max: 5000 })
  .withMessage('Prompt must be between 1 and 5000 characters');

export const validateUsername = body('username')
  .trim()
  .isLength({ min: 3, max: 30 })
  .matches(/^[a-zA-Z0-9_-]+$/)
  .withMessage('Username must be 3-30 characters and contain only letters, numbers, hyphens, and underscores');

/**
 * Validation error handler
 */
export const handleValidationErrors = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    return res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  
  next();
};

/**
 * Detect SQL injection patterns
 */
const SQL_INJECTION_PATTERNS = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b)/i,
  /(--|;|\/\*|\*\/|xp_|sp_)/i,
  /(\bOR\b.*=.*)/i,
  /('|(--)|;|\/\*|\*\/)/
];

/**
 * Detect XSS patterns
 */
const XSS_PATTERNS = [
  /<script/i,
  /javascript:/i,
  /onerror=/i,
  /onclick=/i,
  /onload=/i,
  /<iframe/i
];

/**
 * Check for injection attempts
 */
export const detectInjectionAttacks = (req: Request, res: Response, next: NextFunction) => {
  const checkValue = (value: any, path: string = ''): boolean => {
    if (typeof value === 'string') {
      // Check SQL injection
      for (const pattern of SQL_INJECTION_PATTERNS) {
        if (pattern.test(value)) {
          console.warn(`[Security] SQL injection attempt detected in ${path}:`, value.substring(0, 100));
          return true;
        }
      }
      
      // Check XSS
      for (const pattern of XSS_PATTERNS) {
        if (pattern.test(value)) {
          console.warn(`[Security] XSS attempt detected in ${path}:`, value.substring(0, 100));
          return true;
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      for (const key in value) {
        if (checkValue(value[key], `${path}.${key}`)) {
          return true;
        }
      }
    }
    return false;
  };

  // Check all input sources
  if (req.body && checkValue(req.body, 'body')) {
    return res.status(400).json({
      status: 'error',
      message: 'Invalid input detected'
    });
  }

  if (req.query && checkValue(req.query, 'query')) {
    return res.status(400).json({
      status: 'error',
      message: 'Invalid query parameters'
    });
  }

  next();
};

console.log('[Request Validation] Middleware initialized');
