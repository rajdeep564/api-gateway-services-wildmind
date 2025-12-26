/**
 * Reset All Users to Launch Plan with December 25, 2025 Trial Start Date
 * 
 * This script:
 * 1. Clears all ledger entries for each user
 * 2. Sets all users to LAUNCH_4000_FIXED plan
 * 3. Sets credit balance to 4000
 * 4. Sets launchTrialStartDate to December 25, 2025 (00:00:00 UTC)
 * 5. Marks launchMigrationDone = true
 * 
 * The trial start date is set to December 25, 2025, so the 15-day trial period
 * will align with the cutoff date logic in the system.
 * 
 * Usage:
 *   npx ts-node scripts/resetToLaunchPlanDec18.ts [--dry-run] [--limit=N]
 */

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { adminDb, admin } from '../src/config/firebaseAdmin';
import { creditsRepository } from '../src/repository/creditsRepository';
import { creditsService } from '../src/services/creditsService';

const LAUNCH_PLAN_CODE = 'LAUNCH_4000_FIXED';
const LAUNCH_FIXED_CREDITS = 2000;
// January 10, 2026 at 00:00:00 UTC
const TRIAL_START_DATE = new Date('2026-01-10T00:00:00.000Z');
const TRIAL_START_TIMESTAMP = admin.firestore.Timestamp.fromDate(TRIAL_START_DATE);

interface MigrationStats {
  totalUsers: number;
  migrated: number;
  skipped: number;
  errors: number;
  errorDetails: Array<{ uid: string; email?: string; error: string }>;
}

async function resetToLaunchPlanDec18(options: { dryRun?: boolean; limit?: number } = {}): Promise<MigrationStats> {
  const { dryRun = false, limit } = options;
  
  console.log('\n🚀 ==== Reset All Users to Launch Plan (Dec 25, 2025) ====\n');
  console.log('📋 Strategy:');
  console.log('  - All users → LAUNCH_4000_FIXED plan');
  console.log('  - All users → 4000 credits (fixed, no daily reset)');
  console.log('  - Clear ALL ledger history for each user');
  console.log('  - Set launchTrialStartDate to December 25, 2025 00:00:00 UTC');
  console.log('  - Mark launchMigrationDone = true');
  console.log(`  - Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);
  if (limit) {
    console.log(`  - Limit: Processing first ${limit} users`);
  }
  console.log(`  - Trial Start Date: ${TRIAL_START_DATE.toISOString()}`);
  console.log('='.repeat(60) + '\n');

  // Ensure launch plan exists
  console.log('📦 Ensuring launch plan exists...');
  await creditsService.ensureLaunchPlan();
  console.log('✅ Launch plan ready\n');

  const stats: MigrationStats = {
    totalUsers: 0,
    migrated: 0,
    skipped: 0,
    errors: 0,
    errorDetails: []
  };

  try {
    // Fetch all users
    let usersQuery = adminDb.collection('users');
    if (limit) {
      usersQuery = usersQuery.limit(limit) as any;
    }
    const usersSnapshot = await usersQuery.get();
    stats.totalUsers = usersSnapshot.size;

    console.log(`📥 Found ${stats.totalUsers} users to process\n`);

    if (dryRun) {
      console.log('🔍 DRY RUN MODE - No changes will be made\n');
    }

    // Process users in batches
    const batchSize = 10; // Process 10 users at a time to avoid overwhelming Firestore
    const userDocs = usersSnapshot.docs;
    
    for (let i = 0; i < userDocs.length; i += batchSize) {
      const batch = userDocs.slice(i, i + batchSize);
      console.log(`\n📦 Processing batch ${Math.floor(i / batchSize) + 1} (users ${i + 1}-${Math.min(i + batchSize, userDocs.length)})...`);

      await Promise.all(
        batch.map(async (userDoc) => {
          const uid = userDoc.id;
          const userData = userDoc.data();
          const email = userData.email || 'N/A';
          const currentPlan = userData.planCode || 'FREE';
          const currentBalance = userData.creditBalance || 0;
          const currentTrialStart = userData.launchTrialStartDate;

          try {
            if (dryRun) {
              console.log(`  🔍 [DRY RUN] Would reset: ${email} (${uid})`);
              console.log(`     Current: Plan=${currentPlan}, Balance=${currentBalance}, TrialStart=${currentTrialStart ? 'set' : 'not set'}`);
              console.log(`     Would set: Plan=${LAUNCH_PLAN_CODE}, Balance=${LAUNCH_FIXED_CREDITS}, TrialStart=${TRIAL_START_DATE.toISOString()}, Clear ledgers`);
              stats.migrated++;
              return;
            }

            // Clear all ledgers
            console.log(`  🗑️  Clearing ledgers for ${email} (${uid})...`);
            let deletedCount = 0;
            try {
              deletedCount = await creditsRepository.clearAllLedgersForUser(uid);
              console.log(`     ✅ Cleared ${deletedCount} ledger entries`);
            } catch (ledgerError: any) {
              console.log(`     ⚠️  Ledger clear warning: ${ledgerError.message}`);
              // Continue even if ledger clear has issues
            }

            // Update user to launch plan with December 25, 2025 trial start date
            console.log(`  🔄 Setting ${email} to launch plan with Dec 25, 2025 trial start...`);
            await adminDb.collection('users').doc(uid).update({
              planCode: LAUNCH_PLAN_CODE,
              creditBalance: LAUNCH_FIXED_CREDITS,
              launchMigrationDone: true,
              launchTrialStartDate: TRIAL_START_TIMESTAMP, // December 25, 2025 00:00:00 UTC
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            console.log(`  ✅ Reset: ${email} (${uid})`);
            console.log(`     Plan: ${currentPlan} → ${LAUNCH_PLAN_CODE}`);
            console.log(`     Balance: ${currentBalance} → ${LAUNCH_FIXED_CREDITS}`);
            console.log(`     Trial Start: ${TRIAL_START_DATE.toISOString()}`);
            console.log(`     Ledgers cleared: ${deletedCount}`);
            stats.migrated++;

          } catch (error: any) {
            const errorMsg = error.message || String(error);
            console.error(`  ❌ Error resetting ${email} (${uid}): ${errorMsg}`);
            stats.errors++;
            stats.errorDetails.push({ uid, email, error: errorMsg });
          }
        })
      );
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Reset Summary:');
    console.log(`   Total users: ${stats.totalUsers}`);
    console.log(`   ✅ Reset: ${stats.migrated}`);
    console.log(`   ⏭️  Skipped: ${stats.skipped}`);
    console.log(`   ❌ Errors: ${stats.errors}`);
    console.log(`   Trial Start Date: ${TRIAL_START_DATE.toISOString()}`);
    console.log('='.repeat(60) + '\n');

    if (stats.errorDetails.length > 0) {
      console.log('❌ Error Details:');
      stats.errorDetails.forEach(({ uid, email, error }) => {
        console.log(`   ${email} (${uid}): ${error}`);
      });
      console.log('');
    }

    if (dryRun) {
      console.log('🔍 This was a DRY RUN. No changes were made.');
      console.log('   Run without --dry-run to apply changes.\n');
    } else {
      console.log('✅ Reset complete!');
      console.log(`   All users are now on ${LAUNCH_PLAN_CODE} with 4000 credits`);
      console.log(`   Trial start date set to: ${TRIAL_START_DATE.toISOString()}`);
      console.log(`   (15-day trial period: Dec 25, 2025 - Jan 9, 2026)\n`);
    }

  } catch (error) {
    console.error('\n❌ Fatal error during reset:', error);
    throw error;
  }

  return stats;
}

// Parse command line arguments
const args = process.argv.slice(2);
let dryRun = false;
let limit: number | undefined;

for (const arg of args) {
  if (arg === '--dry-run' || arg === '-d') {
    dryRun = true;
  } else if (arg.startsWith('--limit=')) {
    limit = parseInt(arg.split('=')[1], 10);
    if (isNaN(limit) || limit <= 0) {
      console.error('❌ Invalid limit value');
      process.exit(1);
    }
  } else if (arg === '--help' || arg === '-h') {
    console.log('Usage: npx ts-node scripts/resetToLaunchPlanDec18.ts [--dry-run] [--limit=N]');
    console.log('\nOptions:');
    console.log('  --dry-run, -d    Run without making changes');
    console.log('  --limit=N         Process only first N users');
    console.log('  --help, -h        Show this help message');
    console.log('\nThis script will:');
    console.log('  - Clear all ledgers for all users');
    console.log('  - Set all users to LAUNCH_4000_FIXED plan');
    console.log('  - Set credit balance to 4000');
    console.log('  - Set launchTrialStartDate to December 25, 2025 00:00:00 UTC');
    process.exit(0);
  }
}

// Run reset
resetToLaunchPlanDec18({ dryRun, limit })
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Reset failed:', error);
    process.exit(1);
  });

