export type LedgerStatus = 'PENDING' | 'CONFIRMED' | 'REVERSED';
export type LedgerType = 'GRANT' | 'DEBIT' | 'REFUND' | 'HOLD';

export interface PlanDoc {
  code: string;
  name: string;
  credits: number;
  priceInPaise: number;
  active: boolean;
  sort?: number;
  createdAt?: any;
  updatedAt?: any;
}

export interface UserCreditsDoc {
  uid: string;
  creditBalance: number;
  planCode: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface LedgerEntry {
  type: LedgerType;
  amount: number; // positive for GRANT/REFUND, negative for DEBIT/HOLD
  reason: string;
  status: LedgerStatus;
  meta?: Record<string, any>;
  createdAt?: any;
}

export interface CreditCostResult {
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}


