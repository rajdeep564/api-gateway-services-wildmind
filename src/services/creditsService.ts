import { creditsRepository } from '../repository/creditsRepository';
import { env } from '../config/env';

const FREE_PLAN_CODE = 'FREE';

/**
 * Refactored Credits Service
 * Delegates storage and basic plan logic to Credit Service (via Repository).
 * Keeps user billing init paths aligned with the canonical credit service catalog.
 */
export const creditsService = {
  
  // These are handled by the microservice now, but we might check/init
  ensureFreePlan: async () => {}, // No-op, service handles it
  ensurePlansSeeded: async () => {}, // No-op, service has its own seeds

  async ensureUserInit(uid: string, email: string = '') {
    return creditsRepository.initUser(uid, email || `${uid}@placeholder.com`);
  },

  async reconcileCurrentCycle(uid: string) {
    const logger = require('../utils/logger').logger;
    // Just proxy to repo/service reconcile
    const result = await creditsRepository.reconcileBalanceFromLedgers(uid);
    
    // Get plan info for return value
    const user = await creditsRepository.readUserInfo(uid);
    const planCredits = 2000;
    
    const now = new Date();
    const cycle = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    return { 
      cycle, 
      newBalance: result.calculatedBalance, 
      debitsSinceReset: result.totalDebits, 
      planCredits 
    };
  },

  async ensureLaunchDailyReset(uid: string) {
     let user = await creditsRepository.readUserInfo(uid);
     if (!user) {
         return { planCode: FREE_PLAN_CODE, creditBalance: 0 };
     }

     return { planCode: user.planCode, creditBalance: user.creditBalance };
  },

  // Monthly Reroll (delegated mostly to service or ignored if launch plan)
  async ensureMonthlyReroll(uid: string) {
      const user = await creditsRepository.readUserInfo(uid);
      const planCode = user?.planCode || FREE_PLAN_CODE;

      const now = new Date();
      const cycle = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      const reqId = `PLAN_RESET_${cycle}`;

      const ledgers = await creditsRepository.listRecentLedgers(uid, 50);
      const hasReset = ledgers.some(l => l.id.includes(cycle) && l.entry.reason.includes('monthly')); // Weak check
      
      if (!hasReset) {
         let credits = 0;
         if (planCode === 'FREE') credits = 0; 

         await creditsRepository.writeGrantAndSetPlanIfAbsent(uid, reqId, credits, planCode, 'plan.monthly_reset');
      }
      
      const updated = await creditsRepository.readUserInfo(uid);
      return { cycle, planCode, creditBalance: updated?.creditBalance || 0 };
  },

  /**
   * Validate if user has sufficient credits AND storage quota for generation
   * This should be called BEFORE starting any generation
   * @returns validation result with error code if invalid
   */
  async validateBeforeGeneration(
    uid: string,
    creditCost: number,
    estimatedSizeBytes: number = 10 * 1024 * 1024, // Default 10MB estimate
    modelName?: string,
    quantity: number = 1
  ): Promise<{ valid: boolean; reason?: string; code?: string }> {
    try {
      await creditsRepository.validateGeneration(uid, creditCost, estimatedSizeBytes, modelName, quantity);
      return { valid: true };
    } catch (error: any) {
      // Extract error code and message
      if (error.code === 'STORAGE_QUOTA_EXCEEDED') {
        return {
          valid: false,
          reason: error.message || 'Storage quota exceeded. Upgrade your plan to continue.',
          code: 'STORAGE_QUOTA_EXCEEDED',
        };
      }
      if (error.code === 'INSUFFICIENT_CREDITS') {
        return {
          valid: false,
          reason: error.message || 'Insufficient credits for this generation.',
          code: 'INSUFFICIENT_CREDITS',
        };
      }
      // Unknown error
      throw error;
    }
  },

  async switchPlan(uid: string, newPlanCode: string) {
     // Just call repo
     await creditsRepository.writeGrantAndSetPlanIfAbsent(uid, `SWITCH_${Date.now()}`, 0, newPlanCode, 'plan.switch');
     const user = await creditsRepository.readUserInfo(uid);
     return { planCode: newPlanCode, creditBalance: user?.creditBalance || 0 };
  }
};
