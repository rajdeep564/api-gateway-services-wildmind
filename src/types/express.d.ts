import 'express';

declare global {
  namespace Express {
    interface Request {
      uid: string;
      email?: string;
      username?: string;
    }
  }
}

export {};


