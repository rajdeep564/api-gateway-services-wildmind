import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { ApiError } from '../utils/errorHandler';
import { creditsService } from '../services/creditsService';
import { creditsRepository } from '../repository/creditsRepository';
import { projectRepository } from '../repository/canvas/projectRepository';

type CostComputer = (req: Request) => Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }>;

async function resolveCanvasBillingUid(req: Request, actorUid: string): Promise<string> {
  const projectId = (req.body as any)?.meta?.projectId || (req.body as any)?.projectId;
  if (!projectId || typeof projectId !== 'string') return actorUid;

  const project = await projectRepository.getProject(projectId);
  if (!project) {
    throw new ApiError('Project not found', 404);
  }

  const collaborator = project.collaborators?.find((c) => c.uid === actorUid);
  const hasAccess = project.ownerUid === actorUid || Boolean(collaborator);
  if (!hasAccess) {
    throw new ApiError('Access denied', 403);
  }

  // For shared "can edit" sessions, bill the owner/admin account.
  if (project.ownerUid !== actorUid && collaborator?.role === 'editor') {
    return project.ownerUid;
  }

  return actorUid;
}

export function makeCreditCost(provider: string, operation: string, computeCost: CostComputer) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actorUid = (req as any).uid;
      if (!actorUid) throw new ApiError('Unauthorized', 401);
      const billingUid = provider === 'canvas'
        ? await resolveCanvasBillingUid(req, actorUid)
        : actorUid;

      const { cost, pricingVersion, meta } = await computeCost(req);
      // Ensure user doc exists and is on launch plan (one-time migration if needed)
      await creditsService.ensureUserInit(billingUid);
      await creditsService.ensureLaunchDailyReset(billingUid);
      
      // Skip balance check if cost is 0 (free models like z-image-turbo)
      if (cost === 0) {
        const idempotencyKey = randomUUID();
        (req as any).context = {
          creditCost: 0,
          reason: `${provider}.${operation}`,
          idempotencyKey,
          pricingVersion,
          meta,
          billingUid,
          actorUid,
        };
        return next();
      }
      
      const creditBalance = await creditsRepository.readUserCredits(billingUid);
      if (creditBalance < cost) {
        return res.status(402).json({
          responseStatus: 'error',
          message: 'Payment Required',
          data: {
            requiredCredits: cost,
            currentBalance: creditBalance,
            suggestion: 'Buy plan or reduce n/size',
          },
        });
      }

      const idempotencyKey = randomUUID();
      (req as any).context = {
        creditCost: cost,
        reason: `${provider}.${operation}`,
        idempotencyKey,
        pricingVersion,
        meta,
        billingUid,
        actorUid,
      };
      next();
    } catch (e) {
      next(e);
    }
  };
}


