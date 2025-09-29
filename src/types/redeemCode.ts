export type RedeemCodeType = 'STUDENT' | 'BUSINESS';
export type RedeemCodeStatus = 'ACTIVE' | 'USED' | 'EXPIRED' | 'DISABLED';

export interface RedeemCodeDoc {
  code: string;
  type: RedeemCodeType;
  planCode: 'PLAN_A' | 'PLAN_B'; // PLAN_A for students, PLAN_B for business
  status: RedeemCodeStatus;
  maxUses: number;
  currentUses: number;
  validUntil?: any; // Firestore Timestamp or Date
  createdAt: any;
  updatedAt: any;
  createdBy?: string; // admin who created it (optional)
  usedBy?: string[]; // array of user IDs who used it
}

export interface RedeemCodeUsage {
  redeemCode: string;
  uid: string;
  username: string;
  email: string;
  planCodeAssigned: string;
  creditsGranted: number;
  usedAt: any;
}

export interface CreateRedeemCodeRequest {
  type: RedeemCodeType;
  count: number;
  expiresIn?: number; // Hours from now - if not provided, defaults to 48 hours
  maxUsesPerCode?: number;
  adminKey?: string; // For basic admin validation
}

export interface RedeemCodeValidationResult {
  valid: boolean;
  planCode?: 'PLAN_A' | 'PLAN_B';
  creditsToGrant?: number;
  remainingTime?: string | null;
  expiresAt?: string | null;
  error?: string;
}
