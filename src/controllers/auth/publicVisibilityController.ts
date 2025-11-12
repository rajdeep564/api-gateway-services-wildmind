import { Request, Response, NextFunction } from 'express';
import { formatApiResponse } from '../../utils/formatApiResponse';
import { publicVisibilityEnforcer } from '../../utils/publicVisibilityEnforcer';
import { logger } from '../../utils/logger';

/**
 * GET /api/auth/can-toggle-public
 * Returns whether user can toggle public generation setting
 * Restricted plans (FREE, PLAN_A, PLAN_B): Cannot toggle (always public)
 * Unrestricted plans (PLAN_C, PLAN_D): Can toggle
 */
async function canTogglePublic(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = req.uid as string;
    if (!uid) {
      return res.status(401).json(formatApiResponse('error', 'Unauthorized', null));
    }

    const canToggle = await publicVisibilityEnforcer.canTogglePublicGeneration(uid);
    const isRestricted = await publicVisibilityEnforcer.isRestrictedPlanUser(uid);

    logger.info({ uid, canToggle, isRestricted }, '[Auth] Can toggle public check');

    res.json(formatApiResponse('success', 'OK', {
      canToggle,
      isRestricted,
      message: canToggle 
        ? 'User can choose public or private generations' 
        : 'Your plan requires all generations to be public. Upgrade to Plan C or D for private generations.',
    }));
  } catch (err) {
    logger.error({ err }, '[Auth] Error checking can toggle public');
    next(err);
  }
}

export const publicVisibilityController = {
  canTogglePublic,
};
