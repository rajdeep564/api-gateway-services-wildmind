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

export async function readUserInfo(uid: string): Promise<{ creditBalance: number; planCode: string } | null> {
  const ref = adminDb.collection('users').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() as any;
  return {
    creditBalance: Number(data.creditBalance || 0),
    planCode: (data.planCode as string) || 'FREE',
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
      const existing = await tx.get(ledgerRef);
      if (existing.exists) {
        const data = existing.data() as any;
        if (data.type === 'GRANT' && data.status === 'CONFIRMED') {
          logger.info({ uid, requestId }, '[CREDITS] Plan switch grant already exists (idempotent)');
          // Still ensure user doc reflects target plan and credits (idempotent set)
          tx.set(userRef, {
            planCode: newPlanCode,
            creditBalance: credits,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
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
      tx.set(userRef, {
        planCode: newPlanCode,
        creditBalance: credits,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
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

export const creditsRepository = {
  readUserCredits,
  readUserInfo,
  listRecentLedgers,
  writeDebitIfAbsent,
  writeGrantAndSetPlanIfAbsent,
};


