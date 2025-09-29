import { Request, Response, NextFunction } from 'express';
import { redeemCodeService } from '../services/redeemCodeService';
import { formatApiResponse } from '../utils/formatApiResponse';
import { ApiError } from '../utils/errorHandler';
import { authRepository } from '../repository/auth/authRepository';
import { env } from '../config/env';
import { RedeemCodeValidationResult } from '../types/redeemCode';

// Apply redeem code during signup
async function applyRedeemCode(req: Request, res: Response, next: NextFunction) {
  try {
    const { redeemCode } = req.body;
    const uid = (req as any).uid;

    if (!uid) {
      throw new ApiError('Authentication required', 401);
    }

    if (!redeemCode || typeof redeemCode !== 'string') {
      throw new ApiError('Redeem code is required', 400);
    }

    // Get user details
    const user = await authRepository.getUserById(uid);
    if (!user) {
      throw new ApiError('User not found', 404);
    }

    // Apply the redeem code
    const result = await redeemCodeService.validateAndUseRedeemCode(
      redeemCode.trim().toUpperCase(),
      uid,
      user.username,
      user.email
    );

    return res.json(formatApiResponse('success', 'Redeem code applied successfully', {
      planCode: result.planCode,
      creditsGranted: result.creditsGranted,
      planName: result.planCode === 'PLAN_A' ? 'Student Plan' : 'Business Plan'
    }));

  } catch (error) {
    next(error);
  }
}

// Validate redeem code (without applying)
async function validateRedeemCode(req: Request, res: Response, next: NextFunction) {
  try {
    const { redeemCode } = req.body;

    if (!redeemCode || typeof redeemCode !== 'string') {
      throw new ApiError('Redeem code is required', 400);
    }

    const result: RedeemCodeValidationResult = await redeemCodeService.getRedeemCodeInfo(redeemCode.trim().toUpperCase());

    return res.json(formatApiResponse('success', 'Redeem code validation result', {
      valid: result.valid,
      error: result.error,
      planCode: result.planCode,
      creditsToGrant: result.creditsToGrant,
      remainingTime: result.remainingTime,
      expiresAt: result.expiresAt,
      planName: result.planCode === 'PLAN_A' ? 'Student Plan' : 
                result.planCode === 'PLAN_B' ? 'Business Plan' : undefined
    }));

  } catch (error) {
    next(error);
  }
}


// Create redeem codes (admin function)
async function createRedeemCodes(req: Request, res: Response, next: NextFunction) {
  try {
    const { type, count, expiresIn, maxUsesPerCode, adminKey } = req.body;

    // Basic admin validation (hardcoded for now)
    const ADMIN_KEY = env.reedemCodeAdminKey;
    if (!adminKey || adminKey !== ADMIN_KEY) {
      throw new ApiError('Unauthorized. Invalid admin key.', 401);
    }

    // Validate required fields
    if (!type || !['STUDENT', 'BUSINESS'].includes(type)) {
      throw new ApiError('Invalid type. Must be STUDENT or BUSINESS', 400);
    }

    if (!count || count <= 0 || count > 1000) {
      throw new ApiError('Count must be between 1 and 1000', 400);
    }

    // Validate expiresIn if provided
    let expiryHours = 48; // Default to 48 hours
    if (expiresIn !== undefined) {
      if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > 8760) { // Max 1 year
        throw new ApiError('expiresIn must be an integer between 1 and 8760 hours (1 year)', 400);
      }
      expiryHours = expiresIn;
    }

    // Validate maxUsesPerCode
    const maxUses = maxUsesPerCode || 1;
    if (maxUses < 1 || maxUses > 100) {
      throw new ApiError('maxUsesPerCode must be between 1 and 100', 400);
    }

    const codes = await redeemCodeService.createRedeemCodes({
      type,
      count,
      expiresIn: expiryHours,
      maxUsesPerCode: maxUses
    });

    const expiryDate = new Date(Date.now() + expiryHours * 60 * 60 * 1000);
    const planName = type === 'STUDENT' ? 'Student Plan (PLAN_A)' : 'Business Plan (PLAN_B)';

    return res.json(formatApiResponse('success', `${codes.length} ${planName} codes created successfully`, {
      codes,
      type,
      planName,
      count: codes.length,
      maxUsesPerCode: maxUses,
      expiresInHours: expiryHours,
      expiresAt: expiryDate.toISOString(),
      expiresAtReadable: expiryDate.toLocaleString(),
      creditsPerCode: type === 'STUDENT' ? 12360 : 24720
    }));

  } catch (error) {
    next(error);
  }
}

export const redeemCodeController = {
  applyRedeemCode,
  validateRedeemCode,
  createRedeemCodes
};
