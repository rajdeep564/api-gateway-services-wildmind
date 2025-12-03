import { adminDb, admin } from '../config/firebaseAdmin';
import { logger } from '../utils/logger';

export type LedgerStatus = 'PENDING' | 'CONFIRMED' | 'REVERSED';
export type LedgerType = 'GRANT' | 'DEBIT' | 'REFUND' | 'HOLD';

export interface LedgerEntry {
  type: LedgerType;
  amount: number; // positive for GRANT/REFUND, negative for DEBIT/HOLD
  reason: string;
  status: LedgerStatus;
  meta?: Record<string, any>;
  createdAt?: any;
}

export async function readUserCredits(uid: string): Promise<number> {
  const ref = adminDb.collection('users').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return 0;
  const data = snap.data() as any;
  return Number(data.creditBalance || 0);
}

export async function readUserInfo(uid: string): Promise<{ creditBalance: number; planCode: string; launchTrialStartDate?: any } | null> {
  const ref = adminDb.collection('users').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() as any;
  return {
    creditBalance: Number(data.creditBalance || 0),
    planCode: (data.planCode as string) || 'FREE',
    launchTrialStartDate: data.launchTrialStartDate,
  };
}

export async function listRecentLedgers(uid: string, limit: number = 10): Promise<Array<{ id: string; entry: LedgerEntry }>> {
  const col = adminDb
    .collection('users')
    .doc(uid)
    .collection('ledgers')
    .orderBy('createdAt', 'desc')
    .limit(limit);
  const snap = await col.get();
  return snap.docs.map((d) => ({ id: d.id, entry: d.data() as LedgerEntry }));
}

/**
 * Reconcile balance from all ledger entries
 * Calculates the actual balance by summing all CONFIRMED ledger entries
 */
export async function reconcileBalanceFromLedgers(uid: string): Promise<{ calculatedBalance: number; totalGrants: number; totalDebits: number; ledgerCount: number }> {
  const userRef = adminDb.collection('users').doc(uid);
  const ledgersCol = userRef.collection('ledgers');
  
  // Get all CONFIRMED ledger entries (without orderBy to avoid index requirement)
  // We'll sort in memory if needed
  const snap = await ledgersCol
    .where('status', '==', 'CONFIRMED')
    .get();
  
  let totalGrants = 0;
  let totalDebits = 0;
  
  snap.docs.forEach(doc => {
    const entry = doc.data() as LedgerEntry;
    const amount = Number(entry.amount || 0);
    
    if (entry.type === 'GRANT' || entry.type === 'REFUND') {
      // GRANT and REFUND are positive amounts
      totalGrants += Math.abs(amount);
    } else if (entry.type === 'DEBIT' || entry.type === 'HOLD') {
      // DEBIT and HOLD are negative amounts, but we store them as negative
      totalDebits += Math.abs(amount);
    }
  });
  
  // Balance = grants - debits
  const calculatedBalance = totalGrants - totalDebits;
  
  return {
    calculatedBalance: Math.max(0, calculatedBalance), // Never go negative
    totalGrants,
    totalDebits,
    ledgerCount: snap.docs.length
  };
}

/**
 * Delete all ledger documents for a given user.
 * Used for one-time migrations (e.g. launch offer reset).
 */
export async function clearAllLedgersForUser(uid: string): Promise<number> {
  const userRef = adminDb.collection('users').doc(uid);
  const ledgersCol = userRef.collection('ledgers');
  const docs = await ledgersCol.listDocuments();

  let deleted = 0;
  // Firestore batch limit is 500 ops
  for (let i = 0; i < docs.length; i += 500) {
    const batch = adminDb.batch();
    const slice = docs.slice(i, i + 500);
    slice.forEach((docRef) => batch.delete(docRef));
    await batch.commit();
    deleted += slice.length;
  }

  return deleted;
}

export async function writeDebitIfAbsent(uid: string, requestId: string, amount: number, reason: string, meta?: Record<string, any>): Promise<'SKIPPED' | 'WRITTEN'> {
  const userRef = adminDb.collection('users').doc(uid);
  const ledgerRef = userRef.collection('ledgers').doc(requestId);

  let outcome: 'SKIPPED' | 'WRITTEN' = 'SKIPPED';
  try {
    logger.info({ uid, requestId, amount, reason }, '[CREDITS] Transaction start');
    const sanitize = (obj: any): any => {
      if (obj == null || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map((v) => sanitize(v)).filter((v) => v !== undefined);
      const out: any = {};
      for (const [k, v] of Object.entries(obj)) {
        if (v === undefined) continue;
        const sv = sanitize(v);
        if (sv !== undefined) out[k] = sv;
      }
      return out;
    };
    const metaClean = sanitize(meta || {});
    await adminDb.runTransaction(async (tx) => {
      const existing = await tx.get(ledgerRef);
      if (existing.exists) {
        const data = existing.data() as any;
        if (data.type === 'DEBIT' && data.status === 'CONFIRMED') {
          logger.info({ uid, requestId }, '[CREDITS] Ledger already exists (idempotent)');
          return;
        }
      }
      tx.set(ledgerRef, {
        type: 'DEBIT',
        amount: -Math.abs(amount),
        reason,
        status: 'CONFIRMED',
        meta: metaClean,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      } as LedgerEntry);
      tx.update(userRef, {
        creditBalance: admin.firestore.FieldValue.increment(-Math.abs(amount)),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      outcome = 'WRITTEN';
    });
    const verify = await ledgerRef.get();
    logger.info({ uid, requestId, exists: verify.exists, outcome }, '[CREDITS] Transaction complete, ledger verification');
  } catch (e) {
    logger.error({ uid, requestId, err: e }, '[CREDITS] Transaction error');
    throw e;
  }
  return outcome;
}

export async function writeGrantAndSetPlanIfAbsent(
  uid: string,
  requestId: string,
  credits: number,
  newPlanCode: string,
  reason: string,
  meta?: Record<string, any>
): Promise<'SKIPPED' | 'WRITTEN'> {
  const userRef = adminDb.collection('users').doc(uid);
  const ledgerRef = userRef.collection('ledgers').doc(requestId);
  let outcome: 'SKIPPED' | 'WRITTEN' = 'SKIPPED';
  try {
    logger.info({ uid, requestId, credits, newPlanCode }, '[CREDITS] Plan switch transaction start');
    const sanitize = (obj: any): any => {
      if (obj == null || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map((v) => sanitize(v)).filter((v) => v !== undefined);
      const out: any = {};
      for (const [k, v] of Object.entries(obj)) {
        if (v === undefined) continue;
        const sv = sanitize(v);
        if (sv !== undefined) out[k] = sv;
      }
      return out;
    };
    const metaClean = sanitize(meta || {});
    await adminDb.runTransaction(async (tx) => {
      // Check if user document exists
      const userSnap = await tx.get(userRef);
      const userExists = userSnap.exists;
      
      const existing = await tx.get(ledgerRef);
      if (existing.exists) {
        const data = existing.data() as any;
        if (data.type === 'GRANT' && data.status === 'CONFIRMED') {
          logger.info({ uid, requestId }, '[CREDITS] Plan switch grant already exists (idempotent)');
          // IMPORTANT: Do NOT overwrite creditBalance again – previous debits this cycle would be lost.
          // Only ensure planCode is correct and updatedAt refreshed.
          if (userExists) {
            tx.update(userRef, {
              planCode: newPlanCode,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          } else {
            tx.set(userRef, {
              planCode: newPlanCode,
              creditBalance: credits, // Set balance if user doesn't exist
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
          }
          return;
        }
      }
      tx.set(ledgerRef, {
        type: 'GRANT',
        amount: Math.abs(credits),
        reason,
        status: 'CONFIRMED',
        meta: { ...metaClean, planCode: newPlanCode },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      } as LedgerEntry);
      // OVERWRITE balance, do not carryforward
      // Use update() if user exists, set() with merge if not
      if (userExists) {
        tx.update(userRef, {
          planCode: newPlanCode,
          creditBalance: credits,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        tx.set(userRef, {
          planCode: newPlanCode,
          creditBalance: credits,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      outcome = 'WRITTEN';
    });
    const verify = await ledgerRef.get();
    logger.info({ uid, requestId, exists: verify.exists, outcome }, '[CREDITS] Plan switch transaction complete');
  } catch (e) {
    logger.error({ uid, requestId, err: e }, '[CREDITS] Plan switch transaction error');
    throw e;
  }
  return outcome;
}

/**
 * Write a GRANT ledger entry that INCREMENTS the balance (adds credits).
 * This is the correct way to grant test credits - it adds to the current balance
 * rather than overwriting it, preserving any debits that happened between reads.
 */
export async function writeGrantIncrement(
  uid: string,
  requestId: string,
  grantAmount: number,
  reason: string,
  meta?: Record<string, any>
): Promise<'SKIPPED' | 'WRITTEN'> {
  const userRef = adminDb.collection('users').doc(uid);
  const ledgerRef = userRef.collection('ledgers').doc(requestId);

  let outcome: 'SKIPPED' | 'WRITTEN' = 'SKIPPED';
  try {
    logger.info({ uid, requestId, grantAmount, reason }, '[CREDITS] Grant increment transaction start');
    const sanitize = (obj: any): any => {
      if (obj == null || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map((v) => sanitize(v)).filter((v) => v !== undefined);
      const out: any = {};
      for (const [k, v] of Object.entries(obj)) {
        if (v === undefined) continue;
        const sv = sanitize(v);
        if (sv !== undefined) out[k] = sv;
      }
      return out;
    };
    const metaClean = sanitize(meta || {});
    await adminDb.runTransaction(async (tx) => {
      const existing = await tx.get(ledgerRef);
      if (existing.exists) {
        const data = existing.data() as any;
        if (data.type === 'GRANT' && data.status === 'CONFIRMED') {
          logger.info({ uid, requestId }, '[CREDITS] Grant already exists (idempotent)');
          return;
        }
      }
      // Write GRANT ledger entry with the grant amount (positive)
      tx.set(ledgerRef, {
        type: 'GRANT',
        amount: Math.abs(grantAmount), // Grant amount is positive
        reason,
        status: 'CONFIRMED',
        meta: metaClean,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      } as LedgerEntry);
      // INCREMENT balance (add to current balance) - preserves any debits
      tx.update(userRef, {
        creditBalance: admin.firestore.FieldValue.increment(Math.abs(grantAmount)),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      outcome = 'WRITTEN';
    });
    const verify = await ledgerRef.get();
    logger.info({ uid, requestId, exists: verify.exists, outcome }, '[CREDITS] Grant increment transaction complete');
  } catch (e) {
    logger.error({ uid, requestId, err: e }, '[CREDITS] Grant increment transaction error');
    throw e;
  }
  return outcome;
}

export const creditsRepository = {
  readUserCredits,
  readUserInfo,
  listRecentLedgers,
  writeDebitIfAbsent,
  writeGrantAndSetPlanIfAbsent,
  writeGrantIncrement,
  reconcileBalanceFromLedgers,
  clearAllLedgersForUser,
};


