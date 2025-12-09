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
  if (!snap.exists) {
    logger.info({ uid }, '[CREDITS_REPO] readUserInfo - User document does not exist');
    return null;
  }
  const data = snap.data() as any;
  const creditBalance = Number(data.creditBalance || 0);
  const planCode = (data.planCode as string) || 'FREE';

  logger.info({ uid, creditBalance, planCode }, '[CREDITS_REPO] readUserInfo - User info read');

  return {
    creditBalance,
    planCode,
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
  logger.info({ uid }, '[CREDITS_REPO] reconcileBalanceFromLedgers - Starting');

  const userRef = adminDb.collection('users').doc(uid);
  const ledgersCol = userRef.collection('ledgers');

  // Get all CONFIRMED ledger entries (without orderBy to avoid index requirement)
  // We'll sort in memory if needed
  const snap = await ledgersCol
    .where('status', '==', 'CONFIRMED')
    .get();

  logger.info({ uid, ledgerCount: snap.docs.length }, '[CREDITS_REPO] reconcileBalanceFromLedgers - Fetched confirmed ledgers');

  let totalGrants = 0;
  let totalDebits = 0;
  const grantDetails: Array<{ id: string; amount: number; reason: string }> = [];
  const debitDetails: Array<{ id: string; amount: number; reason: string }> = [];

  snap.docs.forEach(doc => {
    const entry = doc.data() as LedgerEntry;
    const amount = Number(entry.amount || 0);

    if (entry.type === 'GRANT' || entry.type === 'REFUND') {
      // GRANT and REFUND are positive amounts
      const absAmount = Math.abs(amount);
      totalGrants += absAmount;
      grantDetails.push({ id: doc.id, amount: absAmount, reason: entry.reason });
    } else if (entry.type === 'DEBIT' || entry.type === 'HOLD') {
      // DEBIT and HOLD are negative amounts, but we store them as negative
      const absAmount = Math.abs(amount);
      totalDebits += absAmount;
      debitDetails.push({ id: doc.id, amount: absAmount, reason: entry.reason });
    }
  });

  // Balance = grants - debits
  const calculatedBalance = totalGrants - totalDebits;
  const finalBalance = Math.max(0, calculatedBalance); // Never go negative

  logger.info({
    uid,
    totalGrants,
    totalDebits,
    calculatedBalance,
    finalBalance,
    grantCount: grantDetails.length,
    debitCount: debitDetails.length,
    topGrants: grantDetails.slice(0, 5),
    topDebits: debitDetails.slice(0, 5)
  }, '[CREDITS_REPO] reconcileBalanceFromLedgers - Calculation complete');

  if (finalBalance === 0 && totalGrants > 0) {
    logger.warn({
      uid,
      totalGrants,
      totalDebits,
      calculatedBalance
    }, '[CREDITS_REPO] WARNING: Final balance is 0 despite having grants!');
  }

  return {
    calculatedBalance: finalBalance,
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
    const debitAmount = Math.abs(amount);
    if (debitAmount <= 0 || !Number.isFinite(debitAmount)) {
      logger.error({ uid, requestId, amount }, '[CREDITS] Invalid debit amount');
      throw new Error(`Invalid debit amount: ${amount}`);
    }

    await adminDb.runTransaction(async (tx) => {
      const existing = await tx.get(ledgerRef);
      if (existing.exists) {
        const data = existing.data() as any;
        if (data.type === 'DEBIT' && data.status === 'CONFIRMED') {
          logger.info({ uid, requestId }, '[CREDITS] Ledger already exists (idempotent)');
          return;
        }
      }

      // Get current user balance to validate
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        logger.error({ uid, requestId }, '[CREDITS] User document does not exist');
        throw new Error(`User ${uid} does not exist`);
      }

      const currentBalance = Number(userSnap.data()?.creditBalance || 0);

      // CRITICAL: Validate balance won't go negative (for logging and safety)
      if (currentBalance < debitAmount) {
        logger.error({
          uid,
          requestId,
          currentBalance,
          debitAmount,
          shortfall: debitAmount - currentBalance
        }, '[CREDITS] Insufficient credits - balance would go negative');
        // Still proceed (might be race condition), but log the issue
      }

      tx.set(ledgerRef, {
        type: 'DEBIT',
        amount: -debitAmount,
        reason,
        status: 'CONFIRMED',
        meta: metaClean,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      } as LedgerEntry);
      tx.update(userRef, {
        creditBalance: admin.firestore.FieldValue.increment(-debitAmount),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      outcome = 'WRITTEN';
      logger.info({
        uid,
        requestId,
        debitAmount,
        currentBalance,
        newBalance: currentBalance - debitAmount
      }, '[CREDITS] Debit transaction committed');
    });

    // Final safety check after transaction
    const userAfter = await userRef.get();
    const finalBalance = Number(userAfter.data()?.creditBalance || 0);
    if (finalBalance < 0) {
      logger.error({
        uid,
        requestId,
        finalBalance,
        debitAmount
      }, '[CREDITS] WARNING: Balance went negative after debit!');
    }
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

    // CRITICAL FIX: Read ledgers BEFORE transaction (can't query subcollections in transaction)
    // This prevents the bug where debits are lost when balance is overwritten
    let finalBalance = credits; // Default to grant amount

    // Check if grant already exists (idempotency check before transaction)
    const existingLedger = await ledgerRef.get();
    if (existingLedger.exists) {
      const data = existingLedger.data() as any;
      if (data.type === 'GRANT' && data.status === 'CONFIRMED') {
        logger.info({ uid, requestId }, '[CREDITS] Plan switch grant already exists (idempotent)');
        // Don't overwrite balance - just update plan code if needed
        const userSnap = await userRef.get();
        if (userSnap.exists) {
          await userRef.update({
            planCode: newPlanCode,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } else {
          await userRef.set({
            planCode: newPlanCode,
            creditBalance: credits,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        }
        return 'SKIPPED';
      }
    }

    // Calculate final balance by accounting for existing debits
    const userSnap = await userRef.get();
    const userExists = userSnap.exists;

    if (userExists) {
      // Get all CONFIRMED ledger entries to calculate actual balance
      const ledgersCol = userRef.collection('ledgers');
      const allLedgersSnap = await ledgersCol
        .where('status', '==', 'CONFIRMED')
        .get();

      // Find the most recent grant before this one (excluding this requestId)
      const previousGrants = allLedgersSnap.docs
        .filter(doc => {
          const entry = doc.data() as LedgerEntry;
          return (entry.type === 'GRANT' || entry.type === 'REFUND') && doc.id !== requestId;
        })
        .sort((a, b) => {
          const aTime = a.data().createdAt?.toMillis?.() || 0;
          const bTime = b.data().createdAt?.toMillis?.() || 0;
          return bTime - aTime; // Most recent first
        });

      if (previousGrants.length > 0) {
        // There was a previous grant - calculate debits since then
        const lastGrantTime = previousGrants[0].data().createdAt?.toMillis?.() || 0;
        const debitsSinceLastGrant = allLedgersSnap.docs
          .filter(doc => {
            const entry = doc.data() as LedgerEntry;
            const entryTime = entry.createdAt?.toMillis?.() || 0;
            return (entry.type === 'DEBIT' || entry.type === 'HOLD') && entryTime > lastGrantTime;
          })
          .reduce((sum, doc) => {
            const amount = Math.abs(Number(doc.data().amount || 0));
            return sum + amount;
          }, 0);

        // New balance = grant amount - debits since last grant
        finalBalance = Math.max(0, credits - debitsSinceLastGrant);
        logger.info({
          uid,
          requestId,
          credits,
          debitsSinceLastGrant,
          finalBalance,
          lastGrantTime
        }, '[CREDITS] Calculated balance accounting for debits since last grant');
      } else {
        // No previous grants - this is the first grant
        // Calculate total debits to subtract from grant
        const totalDebits = allLedgersSnap.docs
          .filter(doc => {
            const entry = doc.data() as LedgerEntry;
            return entry.type === 'DEBIT' || entry.type === 'HOLD';
          })
          .reduce((sum, doc) => {
            const amount = Math.abs(Number(doc.data().amount || 0));
            return sum + amount;
          }, 0);

        finalBalance = Math.max(0, credits - totalDebits);
        logger.info({
          uid,
          requestId,
          credits,
          totalDebits,
          finalBalance
        }, '[CREDITS] First grant - calculated balance accounting for all debits');
      }
    }

    await adminDb.runTransaction(async (tx) => {
      // Re-check ledger in transaction for idempotency (race condition protection)
      const existing = await tx.get(ledgerRef);
      if (existing.exists) {
        const data = existing.data() as any;
        if (data.type === 'GRANT' && data.status === 'CONFIRMED') {
          logger.info({ uid, requestId }, '[CREDITS] Grant already exists in transaction (idempotent)');
          return;
        }
      }

      // Re-check user exists in transaction
      const userSnapInTx = await tx.get(userRef);
      const userExistsInTx = userSnapInTx.exists;

      tx.set(ledgerRef, {
        type: 'GRANT',
        amount: Math.abs(credits),
        reason,
        status: 'CONFIRMED',
        meta: { ...metaClean, planCode: newPlanCode },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      } as LedgerEntry);

      // Set balance to calculated value (accounts for debits)
      // Use update() if user exists, set() with merge if not
      if (userExistsInTx) {
        tx.update(userRef, {
          planCode: newPlanCode,
          creditBalance: finalBalance,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        tx.set(userRef, {
          planCode: newPlanCode,
          creditBalance: finalBalance,
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
  writeRefund,
};

/**
 * Write a REFUND ledger entry that INCREMENTS the balance.
 * Used when a generation fails after credits were debited.
 */
export async function writeRefund(
  uid: string,
  requestId: string,
  amount: number,
  reason: string,
  meta?: Record<string, any>
): Promise<'SKIPPED' | 'WRITTEN'> {
  const userRef = adminDb.collection('users').doc(uid);
  const ledgerRef = userRef.collection('ledgers').doc(`refund-${requestId}`);

  let outcome: 'SKIPPED' | 'WRITTEN' = 'SKIPPED';
  try {
    logger.info({ uid, requestId, amount, reason }, '[CREDITS] Refund transaction start');
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
        logger.info({ uid, requestId }, '[CREDITS] Refund already exists (idempotent)');
        return;
      }

      // Write REFUND ledger entry
      tx.set(ledgerRef, {
        type: 'REFUND',
        amount: Math.abs(amount), // Refund is positive
        reason,
        status: 'CONFIRMED',
        meta: { ...metaClean, originalRequestId: requestId },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      } as LedgerEntry);

      // INCREMENT balance
      tx.update(userRef, {
        creditBalance: admin.firestore.FieldValue.increment(Math.abs(amount)),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      outcome = 'WRITTEN';
    });

    logger.info({ uid, requestId, outcome }, '[CREDITS] Refund transaction complete');
  } catch (e) {
    logger.error({ uid, requestId, err: e }, '[CREDITS] Refund transaction error');
    throw e;
  }
  return outcome;
}


