import 'express';

declare global {
  namespace Express {
    interface Request {
      authenticatedReq?: true;
      uid: string;
      email?: string;
      username?: string;
    }
  }
}

export {};


