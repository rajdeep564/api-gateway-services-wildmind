import { adminDb, admin } from '../config/firebaseAdmin';
import { RedeemCodeDoc, RedeemCodeUsage, RedeemCodeType, RedeemCodeStatus } from '../types/redeemCode';
import { ApiError } from '../utils/errorHandler';

export async function createRedeemCode(
  code: string,
  type: RedeemCodeType,
  planCode: 'PLAN_A' | 'PLAN_C',
  maxUses: number = 1,
  validUntil?: Date,
  createdBy?: string
): Promise<RedeemCodeDoc> {
  const redeemCodeRef = adminDb.collection('redeemCodes').doc(code);
  
  // Check if code already exists
  const existingCode = await redeemCodeRef.get();
  if (existingCode.exists) {
    throw new ApiError('Redeem code already exists', 400);
  }

  const redeemCodeDoc: RedeemCodeDoc = {
    code,
    type,
    planCode,
    status: 'ACTIVE',
    maxUses,
    currentUses: 0,
    validUntil,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    usedBy: [],
    ...(createdBy && { createdBy }) // Only include createdBy if it has a value
  };

  await redeemCodeRef.set(redeemCodeDoc);
  return redeemCodeDoc;
}

export async function getRedeemCode(code: string): Promise<RedeemCodeDoc | null> {
  const redeemCodeRef = adminDb.collection('redeemCodes').doc(code);
  
  const snap = await redeemCodeRef.get();
  
  if (!snap.exists) return null;
  return snap.data() as RedeemCodeDoc;
}

export async function validateRedeemCode(code: string, uid: string): Promise<{
  valid: boolean;
  redeemCode?: RedeemCodeDoc;
  error?: string;
}> {
  const redeemCode = await getRedeemCode(code);
  
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

  // Check if user has already used this code
  if (redeemCode.usedBy && redeemCode.usedBy.includes(uid)) {
    return { valid: false, error: 'You have already used this redeem code' };
  }

  return { valid: true, redeemCode };
}

export async function useRedeemCode(
  code: string,
  uid: string,
  username: string,
  email: string,
  planCodeAssigned: string,
  creditsGranted: number
): Promise<void> {
  const batch = adminDb.batch();
  
  const redeemCodeRef = adminDb.collection('redeemCodes').doc(code);
  const usageRef = adminDb.collection('redeemCodeUsages').doc();

  // Update redeem code usage
  batch.update(redeemCodeRef, {
    currentUses: admin.firestore.FieldValue.increment(1),
    usedBy: admin.firestore.FieldValue.arrayUnion(uid),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  // Create usage record
  const usage: RedeemCodeUsage = {
    redeemCode: code,
    uid,
    username,
    email,
    planCodeAssigned,
    creditsGranted,
    usedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  batch.set(usageRef, usage);

  await batch.commit();
}

export async function listRedeemCodes(
  limit: number = 50,
  type?: RedeemCodeType,
  status?: RedeemCodeStatus
): Promise<RedeemCodeDoc[]> {
  let query = adminDb.collection('redeemCodes').orderBy('createdAt', 'desc');
  
  if (type) {
    query = query.where('type', '==', type);
  }
  
  if (status) {
    query = query.where('status', '==', status);
  }
  
  const snap = await query.limit(limit).get();
  return snap.docs.map(doc => doc.data() as RedeemCodeDoc);
}

export async function getRedeemCodeUsages(
  code: string,
  limit: number = 50
): Promise<RedeemCodeUsage[]> {
  const snap = await adminDb
    .collection('redeemCodeUsages')
    .where('redeemCode', '==', code)
    .orderBy('usedAt', 'desc')
    .limit(limit)
    .get();
  
  return snap.docs.map(doc => doc.data() as RedeemCodeUsage);
}

export const redeemCodeRepository = {
  createRedeemCode,
  getRedeemCode,
  validateRedeemCode,
  useRedeemCode,
  listRedeemCodes,
  getRedeemCodeUsages
};
