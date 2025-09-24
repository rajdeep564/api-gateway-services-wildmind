import 'express';

declare global {
  namespace Express {
    interface Request {
      authenticatedReq?: true;
      uid: string;
      email?: string;
      username?: string;
      context?: {
        creditCost?: number;
        reason?: string;
        idempotencyKey?: string;
        pricingVersion?: string;
        meta?: Record<string, any>;
      };
    }
  }
}

export {};


