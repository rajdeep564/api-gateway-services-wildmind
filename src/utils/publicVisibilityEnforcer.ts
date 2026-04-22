import { creditsRepository } from '../repository/creditsRepository';
import { logger } from './logger';

/**
 * Check if user is on a restricted plan (cannot toggle public/private)
 * Restricted plans: FREE / STARTER / SPARK / CREATOR - all generations are public
 * Unrestricted plans: STUDIO / AGENCY - users can choose public or private
 */
async function isRestrictedPlanUser(uid: string): Promise<boolean> {
  try {
    const userInfo = await creditsRepository.readUserInfo(uid);
    const planCode = (userInfo?.planCode || 'FREE').toUpperCase();
    const canToggle = planCode.startsWith('STUDIO_') || planCode.startsWith('AGENCY_');
    return !canToggle;
  } catch (error) {
    logger.error({ uid, error }, '[PublicVisibility] Error checking plan, defaulting to restricted');
    return true; // Default to restricted for safety
  }
}

/**
 * Enforce public visibility for restricted plan users
 * @param uid - User ID
 * @param requestedIsPublic - What the user requested
 * @returns {isPublic, visibility, reason} - Enforced values
 */
export async function enforcePublicVisibility(
  uid: string,
  requestedIsPublic?: boolean
): Promise<{ isPublic: boolean; visibility: string; reason?: string }> {
  const isRestricted = await isRestrictedPlanUser(uid);

  if (isRestricted) {
    // Restricted plan users: ALWAYS public, ignore private request
    if (requestedIsPublic === false) {
      logger.warn({ uid }, '[PublicVisibility] Restricted plan user attempted to create private generation - forcing public');
    }
    return {
      isPublic: true,
      visibility: 'public',
      reason: 'RESTRICTED_PLAN_REQUIRED_PUBLIC',
    };
  }

  // Unrestricted plan users: Respect their choice
  const isPublic = requestedIsPublic === true;
  return {
    isPublic,
    visibility: isPublic ? 'public' : 'private',
  };
}

/**
 * Check if user can toggle public generation setting
 * Restricted plans: Cannot toggle (always public)
 * Unrestricted plans (STUDIO/AGENCY): Can toggle
 */
export async function canTogglePublicGeneration(uid: string): Promise<boolean> {
  const isRestricted = await isRestrictedPlanUser(uid);
  return !isRestricted; // Can toggle only if NOT restricted
}

export const publicVisibilityEnforcer = {
  isRestrictedPlanUser,
  enforcePublicVisibility,
  canTogglePublicGeneration,
};
