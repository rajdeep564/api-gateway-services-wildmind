/**
 * Middlewares Layer - Central Export
 * All middleware modules should be exported from here for consistent imports
 */

export * from './authMiddleware';
export * from './contentModeration';
export * from './creditCost';
export * from './creditCostFactory';
// export * from './generationMetadata'; // Empty file
export * from './ipFirewall';
export * from './logger';
export * from './rateLimiter';
export * from './security';

// Explicit exports to avoid conflicts with 'validateUsername' and 'handleValidationErrors'
export {
  validateSession,
  validateOtpStart,
  validateOtpVerify,
  validateUpdateMe,
  validateLogin,
  validateForgotPassword,
  validateGoogleSignIn,
  validateGoogleUsername,
  validateCheckUsername,
  validateUsername as validateAuthUsername // Renaming to avoid conflict
} from './validateAuth';

export {
  validateCreateGeneration,
  validateUpdateGenerationStatus,
  validateListGenerations
} from './validateGenerations';

export {
  validatePublicListGenerations,
  validateGenerationId
} from './validatePublicGenerations';

export * from './validation';
