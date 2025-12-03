/**
 * Switch User to Any Plan
 * 
 * This script:
 * 1. Clears all ledger entries for the user
 * 2. Sets user to the specified plan
 * 3. Sets credit balance to the plan's default credits
 * 4. Clears launchMigrationDone flag (if moving away from launch plan)
 * 
 * Usage:
 *   npx ts-node scripts/switchUserPlan.ts [--username <username> | <email>] <planCode>
 * 
 * Available Plans:
 *   - LAUNCH_4000_FIXED (4000 credits)
 *   - FREE (4120 credits)
 *   - PLAN_A (varies)
 *   - PLAN_B (varies)
 *   - PLAN_C (varies)
 *   - PLAN_D (varies)
 */

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { adminDb, admin } from '../src/config/firebaseAdmin';
import { creditsRepository } from '../src/repository/creditsRepository';
import { authRepository } from '../src/repository/auth/authRepository';
import { PLAN_CREDITS } from '../src/data/creditDistribution';

const LAUNCH_PLAN_CODE = 'LAUNCH_4000_FIXED';
const LAUNCH_FIXED_CREDITS = 4000;
const FREE_PLAN_CODE = 'FREE';
const FREE_PLAN_CREDITS = 4120;

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
  // Check if plan exists in Firestore
  const planRef = adminDb.collection('plans').doc(planCode);
  const planSnap = await planRef.get();
  
  if (planSnap.exists) {
    const planData = planSnap.data() as any;
    if (planData.credits && typeof planData.credits === 'number') {
      return planData.credits;
    }
  }
  
  // Fallback to hardcoded values
  switch (planCode) {
    case LAUNCH_PLAN_CODE:
      return LAUNCH_FIXED_CREDITS;
    case FREE_PLAN_CODE:
      return FREE_PLAN_CREDITS;
    case 'PLAN_A':
      return PLAN_CREDITS.PLAN_A;
    case 'PLAN_B':
      return PLAN_CREDITS.PLAN_B;
    case 'PLAN_C':
      return PLAN_CREDITS.PLAN_C;
    case 'PLAN_D':
      return PLAN_CREDITS.PLAN_D;
    default:
      throw new Error(`Unknown plan code: ${planCode}. Available: LAUNCH_4000_FIXED, FREE, PLAN_A, PLAN_B, PLAN_C, PLAN_D`);
  }
}

async function switchUserPlan(userInput: ResolveUserInput, planCode: string) {
  console.log('\n🔄 ==== Switch User Plan ====\n');
  console.log(userInput.type === 'email' ? `Email: ${userInput.value}` : `Username: ${userInput.value}`);
  console.log(`Target Plan: ${planCode}`);
  console.log('-----------------------------------\n');

  try {
    // Resolve user
    const userResult = await resolveUserIdentifier(userInput);
    const userId = userResult.uid;
    console.log(`User ID: ${userId}`);
    console.log(`Username: ${userResult.user.username || 'N/A'}`);
    console.log('');

    // Get current user info
    const beforeInfo = await creditsRepository.readUserInfo(userId);
    if (!beforeInfo) {
      console.error('❌ User credits info not found');
      process.exit(1);
    }

    // Get full user document to check launchMigrationDone
    const userRef = adminDb.collection('users').doc(userId);
    const userSnap = await userRef.get();
    const userData = userSnap.data() as any;

    console.log(`📊 Current State:`);
    console.log(`   Plan: ${beforeInfo.planCode || 'FREE'}`);
    console.log(`   Balance: ${beforeInfo.creditBalance || 0} credits`);
    console.log(`   Launch Migration Done: ${userData?.launchMigrationDone || false}`);
    console.log('');

    // Get plan credits
    console.log(`🔍 Fetching plan details...`);
    const planCredits = await getPlanCredits(planCode);
    console.log(`   Plan: ${planCode}`);
    console.log(`   Default Credits: ${planCredits}`);
    console.log('');

    // Check if plan code is valid
    const validPlans = [LAUNCH_PLAN_CODE, FREE_PLAN_CODE, 'PLAN_A', 'PLAN_B', 'PLAN_C', 'PLAN_D'];
    if (!validPlans.includes(planCode)) {
      console.error(`❌ Invalid plan code: ${planCode}`);
      console.error(`   Valid plans: ${validPlans.join(', ')}`);
      process.exit(1);
    }

    // Clear all ledgers
    console.log(`🗑️  Clearing all ledger entries...`);
    let deletedCount = 0;
    try {
      deletedCount = await creditsRepository.clearAllLedgersForUser(userId);
      console.log(`   ✅ Cleared ${deletedCount} ledger entries`);
    } catch (ledgerError: any) {
      console.error(`   ❌ Error clearing ledgers: ${ledgerError.message}`);
      throw ledgerError;
    }
    console.log('');

    // Update user to new plan
    console.log(`🔄 Switching user to ${planCode} plan...`);
    
    const updateData: any = {
      planCode: planCode,
      creditBalance: planCredits,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Clear launchMigrationDone and launchTrialStartDate if moving away from launch plan
    if (userData?.planCode === LAUNCH_PLAN_CODE && planCode !== LAUNCH_PLAN_CODE) {
      console.log(`   Clearing launchMigrationDone flag (moving away from launch plan)`);
      updateData.launchMigrationDone = false;
      updateData.launchTrialStartDate = null;
    } else if (planCode === LAUNCH_PLAN_CODE) {
      // Set launchMigrationDone and launchTrialStartDate if moving to launch plan
      updateData.launchMigrationDone = true;
      updateData.launchTrialStartDate = admin.firestore.FieldValue.serverTimestamp();
      console.log(`   Setting launchTrialStartDate for 15-day trial tracking`);
    }

    await userRef.update(updateData);
    console.log(`   ✅ User switched to ${planCode} plan`);
    console.log(`   ✅ Credit balance set to ${planCredits} credits`);
    console.log('');

    // Create initial grant ledger entry for the plan credits
    console.log(`📝 Creating initial grant ledger entry...`);
    const requestId = `PLAN_SWITCH_${planCode}_${Date.now()}`;
    const grantResult = await creditsRepository.writeGrantAndSetPlanIfAbsent(
      userId,
      requestId,
      planCredits,
      planCode,
      'admin.plan_switch',
      {
        previousPlan: beforeInfo.planCode || 'FREE',
        previousBalance: beforeInfo.creditBalance || 0,
        planSwitch: true,
        reason: 'Admin plan switch via script'
      }
    );

    if (grantResult === 'WRITTEN') {
      console.log(`   ✅ Initial grant ledger entry created`);
    } else {
      console.log(`   ⚠️  Grant ledger entry was skipped (idempotency)`);
    }
    console.log('');

    // Verify final state
    const afterInfo = await creditsRepository.readUserInfo(userId);
    const afterReconciled = await creditsRepository.reconcileBalanceFromLedgers(userId);

    console.log(`📊 Final State:`);
    console.log(`   Plan: ${afterInfo?.planCode}`);
    console.log(`   Stored Balance: ${afterInfo?.creditBalance} credits`);
    console.log(`   Reconciled Balance: ${afterReconciled.calculatedBalance} credits`);
    console.log(`   Expected Balance: ${planCredits} credits`);
    console.log('');

    // Verify balance matches
    const balanceMatches = Math.abs((afterInfo?.creditBalance || 0) - planCredits) < 1;
    const reconciledMatches = Math.abs(afterReconciled.calculatedBalance - planCredits) < 1;

    if (!balanceMatches || !reconciledMatches) {
      console.log(`   ⚠️  WARNING: Balance mismatch detected!`);
      if (!balanceMatches) {
        console.log(`   Stored balance (${afterInfo?.creditBalance}) doesn't match expected (${planCredits})`);
      }
      if (!reconciledMatches) {
        console.log(`   Reconciled balance (${afterReconciled.calculatedBalance}) doesn't match expected (${planCredits})`);
      }
      console.log(`   🔧 Auto-fixing...`);
      
      await userRef.update({
        creditBalance: planCredits,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`   ✅ Balance corrected to ${planCredits} credits`);
      console.log('');
    } else {
      console.log(`   ✅ Balance verified: Matches plan credits`);
      console.log('');
    }

    // Show recent ledger entries
    console.log(`📋 Recent Ledger Entries (last 3):`);
    const recentLedgers = await creditsRepository.listRecentLedgers(userId, 3);
    if (recentLedgers.length === 0) {
      console.log('   ⚠️  No ledger entries found!');
    } else {
      recentLedgers.forEach((ledger, idx) => {
        const entry = ledger.entry;
        const createdAt = entry.createdAt 
          ? (entry.createdAt.toDate ? entry.createdAt.toDate().toISOString() : String(entry.createdAt))
          : 'N/A';
        console.log(`   ${idx + 1}. [${entry.type}] ${entry.amount > 0 ? '+' : ''}${entry.amount} credits`);
        console.log(`      Reason: ${entry.reason}`);
        console.log(`      Status: ${entry.status}`);
        console.log(`      Created: ${createdAt}`);
        if (ledger.id === requestId) {
          console.log(`      ✅ This is the plan switch grant we just created!`);
        }
        console.log('');
      });
    }

    console.log('✅ Plan switch complete!');
    console.log(`   User: ${userResult.user.email || userResult.user.username}`);
    console.log(`   Plan: ${beforeInfo.planCode || 'FREE'} → ${planCode}`);
    console.log(`   Balance: ${beforeInfo.creditBalance || 0} → ${planCredits} credits`);
    console.log(`   Ledgers cleared: ${deletedCount} entries`);

  } catch (error) {
    console.error('\n❌ Error switching plan:', error);
    throw error;
  }

  console.log('\n===================================\n');
}

// Parse command line arguments
const args = process.argv.slice(2);
let identifier: ResolveUserInput | null = null;
let planCode: string | null = null;

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
  } else if (arg === '--plan' || arg === '-p') {
    const value = args[i + 1];
    if (!value) {
      console.error('❌ Missing value for --plan');
      process.exit(1);
    }
    planCode = value.toUpperCase();
    i++;
  } else if (arg === '--help' || arg === '-h') {
    console.log('Usage: npx ts-node scripts/switchUserPlan.ts [--username <username> | <email>] [--plan <planCode>]');
    console.log('\nOptions:');
    console.log('  --username, -u <username>  User username');
    console.log('  --plan, -p <planCode>      Plan code (required)');
    console.log('  --help, -h                 Show this help message');
    console.log('\nAvailable Plans:');
    console.log('  LAUNCH_4000_FIXED  - 4000 credits (Launch Offer)');
    console.log('  FREE                - 4120 credits');
    console.log('  PLAN_A              - Varies by configuration');
    console.log('  PLAN_B              - Varies by configuration');
    console.log('  PLAN_C              - Varies by configuration');
    console.log('  PLAN_D              - Varies by configuration');
    console.log('\nExamples:');
    console.log('  npx ts-node scripts/switchUserPlan.ts user@example.com --plan LAUNCH_4000_FIXED');
    console.log('  npx ts-node scripts/switchUserPlan.ts --username jane_doe --plan PLAN_A');
    process.exit(0);
  } else if (!identifier) {
    identifier = { type: 'email', value: arg };
  } else if (!planCode) {
    planCode = arg.toUpperCase();
  }
}

if (!identifier) {
  console.error('❌ Usage: npx ts-node scripts/switchUserPlan.ts [--username <username> | <email>] [--plan <planCode>]');
  console.error('\nExamples:');
  console.error('  npx ts-node scripts/switchUserPlan.ts user@example.com --plan LAUNCH_4000_FIXED');
  console.error('  npx ts-node scripts/switchUserPlan.ts --username jane_doe --plan PLAN_A');
  process.exit(1);
}

if (!planCode) {
  console.error('❌ Plan code is required. Use --plan <planCode>');
  console.error('\nAvailable plans: LAUNCH_4000_FIXED, FREE, PLAN_A, PLAN_B, PLAN_C, PLAN_D');
  process.exit(1);
}

// Run the script
switchUserPlan(identifier, planCode)
  .then(() => {
    console.log('✅ Plan switch complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Plan switch failed:', error);
    process.exit(1);
  });

