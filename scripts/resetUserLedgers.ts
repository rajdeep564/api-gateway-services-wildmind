/**
 * Reset User Ledgers
 *
 * Clears all ledger entries for a user and resets their balance to the
 * current plan's credit allocation by creating a single GRANT ledger.
 *
 * Usage:
 *   npx ts-node scripts/resetUserLedgers.ts <email> [--dry-run]
 *   npx ts-node scripts/resetUserLedgers.ts --username <username> [--dry-run]
 */

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { adminDb, admin } from '../src/config/firebaseAdmin';
import { authRepository } from '../src/repository/auth/authRepository';
import { creditsRepository } from '../src/repository/creditsRepository';
import { creditsService } from '../src/services/creditsService';

type ResolveUserInput =
  | { type: 'email'; value: string }
  | { type: 'username'; value: string };

type ResolvedUser = { uid: string; user: any };

async function resolveUserIdentifier(input: ResolveUserInput): Promise<ResolvedUser> {
  if (input.type === 'email') {
    const userResult = await authRepository.getUserByEmail(input.value);
    if (!userResult) throw new Error(`User not found with email ${input.value}`);
    return userResult;
  }

  if (typeof authRepository.getUserByUsername === 'function') {
    const user = await authRepository.getUserByUsername(input.value);
    if (!user) throw new Error(`User not found with username ${input.value}`);
    return { uid: user.uid, user };
  }

  throw new Error('Username lookup is not supported in authRepository.');
}

async function getPlanCredits(planCode: string): Promise<number> {
  const planSnap = await adminDb.collection('plans').doc(planCode).get();
  if (planSnap.exists) {
    const data = planSnap.data() as any;
    const credits = Number(data?.credits);
    if (Number.isFinite(credits) && credits > 0) return credits;
  }

  // Fallbacks for known plans
  if (planCode === 'LAUNCH_4000_FIXED') return 4000;
  if (planCode === 'FREE') return 2000;
  return 0;
}

async function resetUserLedgers(userInput: ResolveUserInput, dryRun: boolean) {
  console.log('\n🧹 ==== Reset User Ledgers ====\n');
  console.log(userInput.type === 'email' ? `Email: ${userInput.value}` : `Username: ${userInput.value}`);
  console.log(`Dry run: ${dryRun ? 'YES (no writes)' : 'no'}`);
  console.log('-----------------------------------\n');

  const userResult = await resolveUserIdentifier(userInput);
  const uid = userResult.uid;

  console.log(`User ID: ${uid}`);
  console.log(`Username: ${userResult.user?.username || 'N/A'}`);
  console.log('');

  // Ensure user exists and has a plan/balance
  await creditsService.ensureUserInit(uid);
  const beforeInfo = await creditsRepository.readUserInfo(uid);
  if (!beforeInfo) {
    throw new Error('User credits info not found');
  }

  const planCode = beforeInfo.planCode || 'FREE';
  const planCredits = await getPlanCredits(planCode);

  console.log(`Current plan: ${planCode}`);
  console.log(`Plan credits: ${planCredits}`);
  console.log(`Stored balance: ${beforeInfo.creditBalance}`);
  console.log('');

  if (planCredits <= 0) {
    throw new Error(`Could not determine credits for plan ${planCode}`);
  }

  // Clear all ledgers
  if (dryRun) {
    console.log('🧪 Dry run: would clear all ledgers for user.');
  } else {
    const deleted = await creditsRepository.clearAllLedgersForUser(uid);
    console.log(`🗑️  Cleared ${deleted} ledger entries`);
  }

  // Zero out balance before regranting
  if (dryRun) {
    console.log('🧪 Dry run: would set balance to 0 before regrant.');
  } else {
    const userRef = adminDb.collection('users').doc(uid);
    await userRef.set(
      {
        creditBalance: 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    console.log('🔄 Balance set to 0 prior to grant');
  }

  // Create a fresh grant matching plan credits so ledger and balance stay in sync
  const requestId = `RESET_PLAN_${Date.now()}`;
  if (dryRun) {
    console.log(`🧪 Dry run: would grant ${planCredits} credits with requestId ${requestId}`);
  } else {
    const result = await creditsRepository.writeGrantIncrement(
      uid,
      requestId,
      planCredits,
      'manual.reset.plan',
      {
        previousBalance: beforeInfo.creditBalance,
        planCode,
        resetReason: 'manual_full_clear',
        planCredits,
      }
    );
    console.log(`✅ Grant result: ${result}`);
  }

  // Verify final balances
  const afterInfo = dryRun ? beforeInfo : await creditsRepository.readUserInfo(uid);
  const afterReconciled = dryRun ? await creditsRepository.reconcileBalanceFromLedgers(uid).catch(() => ({
    calculatedBalance: beforeInfo.creditBalance,
    totalGrants: 0,
    totalDebits: 0,
    ledgerCount: 0,
  })) : await creditsRepository.reconcileBalanceFromLedgers(uid);

  const expectedBalance = dryRun ? beforeInfo.creditBalance : planCredits;

  console.log('\n📊 After reset:');
  console.log(`   Stored Balance: ${afterInfo?.creditBalance}`);
  console.log(`   Reconciled Balance: ${afterReconciled.calculatedBalance}`);
  console.log(`   Expected Balance: ${expectedBalance}`);
  console.log(`   Plan: ${planCode}`);
  console.log('');

  const matches = Math.abs(afterReconciled.calculatedBalance - expectedBalance) < 1;
  if (!matches) {
    console.log('⚠️  WARNING: Reconciled balance does not match expected. Please investigate.');
  } else {
    console.log('✅ Balance and ledger are synchronized with plan credits.');
  }

  console.log('\n===================================\n');
}

// Parse command line arguments
const args = process.argv.slice(2);
let identifier: ResolveUserInput | null = null;
let options: { dryRun?: boolean } = {};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '-u' || arg === '--username') {
    const value = args[i + 1];
    if (!value) {
      console.error('❌ Missing value for --username');
      process.exit(1);
    }
    identifier = { type: 'username', value };
    i++;
  } else if (arg === '--dry-run' || arg === '--dryrun') {
    options.dryRun = true;
  } else if (!identifier) {
    identifier = { type: 'email', value: arg };
  }
}

if (!identifier) {
  console.error('❌ Usage: npx ts-node scripts/resetUserLedgers.ts [--username <username> | <email>] [--dry-run]');
  process.exit(1);
}

resetUserLedgers(identifier, options.dryRun === true)
  .then(() => {
    console.log('✅ Reset complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Reset failed:', error);
    process.exit(1);
  });

