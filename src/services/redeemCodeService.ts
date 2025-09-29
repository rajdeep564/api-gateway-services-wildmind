import { redeemCodeRepository } from '../repository/redeemCodeRepository';
import { creditsService } from './creditsService';
import { PLAN_CREDITS } from '../data/creditDistribution';
import { RedeemCodeType, CreateRedeemCodeRequest, RedeemCodeValidationResult } from '../types/redeemCode';
import { ApiError } from '../utils/errorHandler';
import { authRepository } from '../repository/auth/authRepository';

// Generate a random redeem code
function generateRedeemCode(type: RedeemCodeType): string {
  const prefix = type === 'STUDENT' ? 'STU' : 'BUS';
  const timestamp = Date.now().toString().slice(-6); // Last 6 digits of timestamp
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
}

export async function createRedeemCodes(request: CreateRedeemCodeRequest): Promise<string[]> {
  const { type, count, expiresIn, maxUsesPerCode = 1 } = request;
  
  if (count <= 0 || count > 1000) {
    throw new ApiError('Count must be between 1 and 1000', 400);
  }

  const planCode = type === 'STUDENT' ? 'PLAN_A' : 'PLAN_B';
  
  // Calculate expiry date from hours
  const expiryHours = expiresIn || 48; // Default to 48 hours if not specified
  const validUntilDate = new Date(Date.now() + expiryHours * 60 * 60 * 1000);
  
  const codes: string[] = [];
  
  for (let i = 0; i < count; i++) {
    const code = generateRedeemCode(type);
    try {
      await redeemCodeRepository.createRedeemCode(
        code,
        type,
        planCode,
        maxUsesPerCode,
        validUntilDate
      );
      codes.push(code);
    } catch (error) {
      console.error(`Failed to create redeem code ${code}:`, error);
      // If code generation fails (e.g., duplicate), try again
      i--; // Retry this iteration
    }
  }
  
  return codes;
}

export async function validateAndUseRedeemCode(
  code: string,
  uid: string,
  username: string,
  email: string
): Promise<{ planCode: string; creditsGranted: number }> {
  // Validate the redeem code
  const validation = await redeemCodeRepository.validateRedeemCode(code, uid);
  
  if (!validation.valid || !validation.redeemCode) {
    throw new ApiError(validation.error || 'Invalid redeem code', 400);
  }

  const { redeemCode } = validation;
  const planCode = redeemCode.planCode;
  
  // Get credits for the plan
  const creditsToGrant = planCode === 'PLAN_A' ? PLAN_CREDITS.PLAN_A : PLAN_CREDITS.PLAN_B;
  
  try {
    // Switch user to the new plan (this will grant credits and set plan)
    await creditsService.switchPlan(uid, planCode);
    
    // Record the redeem code usage
    await redeemCodeRepository.useRedeemCode(
      code,
      uid,
      username,
      email,
      planCode,
      creditsToGrant
    );
    
    return { planCode, creditsGranted: creditsToGrant };
  } catch (error) {
    console.error('Failed to apply redeem code:', error);
    throw new ApiError('Failed to apply redeem code. Please try again.', 500);
  }
}

export async function getRedeemCodeInfo(code: string): Promise<RedeemCodeValidationResult> {
  const redeemCode = await redeemCodeRepository.getRedeemCode(code);
  
  if (!redeemCode) {
    return { valid: false, error: 'Invalid redeem code' };
  }

  if (redeemCode.status !== 'ACTIVE') {
    return { valid: false, error: 'Redeem code is not active' };
  }

  if (redeemCode.currentUses >= redeemCode.maxUses) {
    return { valid: false, error: 'Redeem code has reached maximum uses' };
  }


  if (redeemCode.validUntil) {
    // Convert Firestore Timestamp to JavaScript Date
    let expiryDate: Date;
    if (redeemCode.validUntil && typeof redeemCode.validUntil.toDate === 'function') {
      // It's a Firestore Timestamp
      expiryDate = redeemCode.validUntil.toDate();
    } else {
      // It's already a Date object or timestamp
      expiryDate = new Date(redeemCode.validUntil);
    }
    
    const now = new Date();
    
    if (now > expiryDate) {
      const expiredHoursAgo = Math.floor((now.getTime() - expiryDate.getTime()) / (1000 * 60 * 60));
      
      let errorMessage;
      if (expiredHoursAgo < 24) {
        errorMessage = `Redeem code expired ${expiredHoursAgo} hour${expiredHoursAgo === 1 ? '' : 's'} ago (${expiryDate.toLocaleString()})`;
      } else {
        const expiredDaysAgo = Math.floor(expiredHoursAgo / 24);
        errorMessage = `Redeem code expired ${expiredDaysAgo} day${expiredDaysAgo === 1 ? '' : 's'} ago (${expiryDate.toLocaleString()})`;
      }
      
      return { valid: false, error: errorMessage };
    }
  }

  const creditsToGrant = redeemCode.planCode === 'PLAN_A' ? PLAN_CREDITS.PLAN_A : PLAN_CREDITS.PLAN_B;

  // Calculate remaining time
  let remainingTime = null;
  let expiresAt = null;
  if (redeemCode.validUntil) {
    const now = new Date();
    let expiryDate: Date;
    if (redeemCode.validUntil && typeof redeemCode.validUntil.toDate === 'function') {
      // It's a Firestore Timestamp
      expiryDate = redeemCode.validUntil.toDate();
    } else {
      // It's already a Date object or timestamp
      expiryDate = new Date(redeemCode.validUntil);
    }
    
    expiresAt = expiryDate.toISOString();
    const remainingMs = expiryDate.getTime() - now.getTime();
    
    if (remainingMs > 0) {
      const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
      const remainingMinutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
      
      if (remainingHours > 24) {
        const remainingDays = Math.floor(remainingHours / 24);
        remainingTime = `${remainingDays} day${remainingDays === 1 ? '' : 's'} ${remainingHours % 24} hour${(remainingHours % 24) === 1 ? '' : 's'}`;
      } else if (remainingHours > 0) {
        remainingTime = `${remainingHours} hour${remainingHours === 1 ? '' : 's'} ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`;
      } else {
        remainingTime = `${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`;
      }
    }
  }

  return {
    valid: true,
    planCode: redeemCode.planCode,
    creditsToGrant,
    remainingTime,
    expiresAt
  };
}

// Generate test codes for development
export async function generateTestCodes(): Promise<{ studentCode: string; businessCode: string }> {
  const studentCodes = await createRedeemCodes({
    type: 'STUDENT',
    count: 1,
    maxUsesPerCode: 10, // Allow multiple uses for testing
  });

  const businessCodes = await createRedeemCodes({
    type: 'BUSINESS',
    count: 1,
    maxUsesPerCode: 10, // Allow multiple uses for testing
  });

  return {
    studentCode: studentCodes[0],
    businessCode: businessCodes[0]
  };
}

export const redeemCodeService = {
  createRedeemCodes,
  validateAndUseRedeemCode,
  getRedeemCodeInfo,
  generateTestCodes
};
