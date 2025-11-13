/**
 * Debug User Credits Script
 * 
 * This script helps diagnose credit system issues:
 * 1. Shows current user credit balance
 * 2. Shows user's plan code
 * 3. Lists recent ledger entries
 * 4. Checks monthly reroll status
 * 5. Optionally forces a monthly reroll
 * 
 * Usage:
 *   npx ts-node scripts/debugUserCredits.ts <userId> [--force-reroll]
 */

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { adminDb } from '../src/config/firebaseAdmin';
import { creditsService } from '../src/services/creditsService';
import { creditsRepository } from '../src/repository/creditsRepository';

async function debugUserCredits(userId: string, forceReroll: boolean = false) {
  console.log('\n🔍 ==== Credit System Diagnostic ====\n');
  console.log(`User ID: ${userId}`);
  console.log('-----------------------------------\n');

  try {
    // 1. Get current user info
    console.log('📊 Current User Info:');
    const userInfo = await creditsRepository.readUserInfo(userId);
    if (!userInfo) {
      console.log('❌ User not found in database');
      console.log('💡 Initializing user...');
      await creditsService.ensureUserInit(userId);
      const newInfo = await creditsRepository.readUserInfo(userId);
      console.log(`✅ User initialized with ${newInfo?.creditBalance} credits on ${newInfo?.planCode} plan`);
      return;
    }

    console.log(`   Credit Balance: ${userInfo.creditBalance}`);
    console.log(`   Plan Code: ${userInfo.planCode}`);
    console.log('');

    // 2. Check what the plan SHOULD have
    console.log('📋 Expected Plan Credits:');
    const planRef = adminDb.collection('plans').doc(userInfo.planCode);
    const planSnap = await planRef.get();
    if (planSnap.exists) {
      const planData = planSnap.data();
      console.log(`   ${userInfo.planCode} Plan: ${planData?.credits} credits`);
      console.log('');
      
      if (userInfo.creditBalance !== planData?.credits) {
        console.log(`⚠️  MISMATCH DETECTED!`);
        console.log(`   User has: ${userInfo.creditBalance} credits`);
        console.log(`   Should have: ${planData?.credits} credits`);
        console.log(`   Difference: ${planData?.credits - userInfo.creditBalance} credits`);
        console.log('');
      }
    }

    // 3. Check monthly reroll cycle
    console.log('📅 Monthly Reroll Status:');
    const now = new Date();
    const currentCycle = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const rerollId = `PLAN_MONTHLY_RESET_${currentCycle}`;
    console.log(`   Current Cycle: ${currentCycle}`);
    console.log(`   Reroll ID: ${rerollId}`);

    const ledgerRef = adminDb
      .collection('users')
      .doc(userId)
      .collection('ledgers')
      .doc(rerollId);
    const ledgerSnap = await ledgerRef.get();

    if (ledgerSnap.exists) {
      const ledgerData = ledgerSnap.data();
      console.log(`   ✅ Reroll already executed for ${currentCycle}`);
      console.log(`   Amount: ${ledgerData?.amount}`);
      console.log(`   Status: ${ledgerData?.status}`);
      console.log(`   Created: ${ledgerData?.createdAt?.toDate?.()}`);
    } else {
      console.log(`   ⚠️  No reroll found for ${currentCycle}`);
      console.log(`   This means the monthly credits haven't been reset yet!`);
    }
    console.log('');

    // 4. List recent ledger entries
    console.log('📜 Recent Ledger Entries (Last 20):');
    const ledgers = await creditsRepository.listRecentLedgers(userId, 20);
    if (ledgers.length === 0) {
      console.log('   No ledger entries found');
    } else {
      ledgers.forEach((ledger, index) => {
        const { id, entry } = ledger;
        console.log(`   ${index + 1}. ID: ${id}`);
        console.log(`      Type: ${entry.type} | Amount: ${entry.amount} | Status: ${entry.status}`);
        console.log(`      Reason: ${entry.reason}`);
        if (entry.createdAt?.toDate) {
          console.log(`      Date: ${entry.createdAt.toDate()}`);
        }
        console.log('');
      });
    }

    // 5. Check for stuck debits or pending transactions
    console.log('🔄 Checking for Issues:');
    const pendingLedgers = ledgers.filter(l => l.entry.status === 'PENDING');
    if (pendingLedgers.length > 0) {
      console.log(`   ⚠️  Found ${pendingLedgers.length} PENDING transactions`);
      console.log('   These may indicate failed generations that didn\'t complete');
      pendingLedgers.forEach(l => {
        console.log(`      - ${l.id}: ${l.entry.amount} credits (${l.entry.reason})`);
      });
      console.log('');
    }

    // 6. Calculate total debits since last reset
    const lastReroll = ledgers.find(l => l.entry.reason === 'plan.monthly_reroll');
    if (lastReroll) {
      const debitsAfterReroll = ledgers
        .filter(l => {
          if (!l.entry.createdAt || !lastReroll.entry.createdAt) return false;
          return l.entry.type === 'DEBIT' && 
                 l.entry.status === 'CONFIRMED' &&
                 l.entry.createdAt.toDate() > lastReroll.entry.createdAt.toDate();
        });
      
      const totalDeducted = debitsAfterReroll.reduce((sum, l) => sum + Math.abs(l.entry.amount), 0);
      console.log(`💳 Credits Used This Cycle:`);
      console.log(`   Last Reroll: ${lastReroll.entry.createdAt?.toDate?.()}`);
      console.log(`   Reroll Amount: ${lastReroll.entry.amount} credits`);
      console.log(`   Total Deducted: ${totalDeducted} credits`);
      console.log(`   Expected Balance: ${lastReroll.entry.amount - totalDeducted} credits`);
      console.log(`   Actual Balance: ${userInfo.creditBalance} credits`);
      
      if (lastReroll.entry.amount - totalDeducted !== userInfo.creditBalance) {
        console.log(`   ⚠️  DISCREPANCY DETECTED!`);
      }
      console.log('');
    }

    // 7. Force reroll if requested
    if (forceReroll) {
      console.log('🔄 Force Reroll Requested...');
      console.log('-----------------------------------\n');
      
      // Delete the current month's reroll ledger to allow re-execution
      if (ledgerSnap.exists) {
        console.log(`   Deleting existing reroll ledger: ${rerollId}`);
        await ledgerRef.delete();
      }
      
      console.log('   Executing monthly reroll...');
      const result = await creditsService.ensureMonthlyReroll(userId);
      console.log(`   ✅ Reroll Complete!`);
      console.log(`   Cycle: ${result.cycle}`);
      console.log(`   Plan: ${result.planCode}`);
      console.log(`   New Balance: ${result.creditBalance} credits`);
      console.log('');

      // Verify the update
      const updatedInfo = await creditsRepository.readUserInfo(userId);
      console.log('✅ Verified Updated Balance:');
      console.log(`   Credit Balance: ${updatedInfo?.creditBalance}`);
      console.log(`   Plan Code: ${updatedInfo?.planCode}`);
    }

  } catch (error) {
    console.error('\n❌ Error during diagnostic:', error);
    throw error;
  }

  console.log('\n===================================\n');
}

// Parse command line arguments
const args = process.argv.slice(2);
const userId = args[0];
const forceReroll = args.includes('--force-reroll');

if (!userId) {
  console.error('❌ Usage: npx ts-node scripts/debugUserCredits.ts <userId> [--force-reroll]');
  console.error('\nOptions:');
  console.error('  --force-reroll    Force a monthly credit reset (deletes existing reroll ledger)');
  process.exit(1);
}

// Run the diagnostic
debugUserCredits(userId, forceReroll)
  .then(() => {
    console.log('✅ Diagnostic complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Diagnostic failed:', error);
    process.exit(1);
  });
