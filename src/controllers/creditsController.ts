import { Request, Response, NextFunction } from 'express';
import { creditsRepository } from '../repository/creditsRepository';
import { formatApiResponse } from '../utils/formatApiResponse';

async function me(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = req.uid;
    const info = await creditsRepository.readUserInfo(uid);
    const recentLedgers = await creditsRepository.listRecentLedgers(uid, 10);
    return res.json(
      formatApiResponse('success', 'Credits fetched', {
        planCode: info?.planCode || 'FREE',
        creditBalance: info?.creditBalance || 0,
        recentLedgers,
      })
    );
  } catch (err) {
    next(err);
  }
}

export const creditsController = { me };


