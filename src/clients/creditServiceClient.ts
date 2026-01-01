
import axios, { AxiosInstance } from 'axios';

export interface CreditBalanceResponse {
    id?: string;
    email?: string;
    creditBalance: number;
    planCode: string | null;
    createdAt?: string | Date; // Can be string from JSON
    updatedAt?: string | Date;
    nextBillingDate?: string | Date | null;
}

export class CreditServiceClient {
    private client: AxiosInstance;
    private baseUrl: string;

    constructor() {
        // Defaults to localhost:3001 if not set
        this.baseUrl = process.env.CREDIT_SERVICE_URL || 'http://localhost:3001';
        this.client = axios.create({
            baseURL: this.baseUrl,
            timeout: 5000, // 5s timeout
        });
    }

    /**
     * Get user balance from Credit Service
     */
    async getBalance(userId: string): Promise<CreditBalanceResponse> {
        try {
            const { data } = await this.client.get(`/credits/${userId}`);
            if (data && data.success) {
                return data.data;
            }
            throw new Error('Invalid response from credit service');
        } catch (error: any) {
            console.error(`[CreditServiceClient] Failed to get balance for ${userId}:`, error.message || error);
            // Fallback to 0 if service down, or throw?
            // Throwing is better to prevent free usage if service is down
            throw error;
        }
    }

    /**
     * Initialize user in Credit Service (ensure they have a plan/balance)
     * Calls getBalance which implicitly checks existence? 
     * Actually credit-service getBalance just returns 0 if not found.
     * We might need an init endpoint or just rely on lazy init?
     * The credit-service as built doesn't auto-create on getBalance.
     * But ensureUserInit in current gateway logic does.
     * 
     * We should rely on credit-service's "ensureUserInit" logic if ported,
     * OR simply use the "grant" or "setBalance" if new user.
     * 
     * For now, let's just stick to getBalance. 
     * If 0, maybe we need to "init".
     */
    
    /**
     * Initialize user in Credit Service
     */
    async initUser(userId: string, email: string) {
        try {
            const { data } = await this.client.post('/users/init', { userId, email });
            if (data && data.success) {
                return data.data;
            }
            throw new Error('Failed to init user');
        } catch (error: any) {
             console.error(`[CreditServiceClient] Failed to init user ${userId}:`, error.message || error);
             throw error;
        }
    }
    
    /**
     * Debit credits
     */
    async debit(userId: string, transactionId: string, amount: number, reason: string, meta?: any) {
        try {
            const { data } = await this.client.post('/credits/debit', {
                userId,
                transactionId,
                amount,
                reason,
                meta
            });
            return data;
        } catch (error: any) {
             console.error(`[CreditServiceClient] Failed to debit ${userId}:`, error.message || error);
             throw error;
        }
    }

    /**
     * Reconcile user credits
     */
    async reconcile(userId: string): Promise<any> {
        try {
            const { data } = await this.client.post(`/credits/reconcile/${userId}`);
            if (data && data.success) {
                return data.data;
            }
            throw new Error('Failed to reconcile');
        } catch (error: any) {
             console.error(`[CreditServiceClient] Failed to reconcile ${userId}:`, error.message || error);
             throw error;
        }
    }

    /**
     * Update user plan
     */
    async updatePlan(userId: string, planCode: string) {
        try {
            const { data } = await this.client.post('/users/plan', { userId, planCode });
            if (data && data.success) {
                return data.data;
            }
            throw new Error('Failed to update plan');
        } catch (error: any) {
             console.error(`[CreditServiceClient] Failed to update plan for ${userId}:`, error.message || error);
             throw error;
        }
    }
}

export const creditServiceClient = new CreditServiceClient();
