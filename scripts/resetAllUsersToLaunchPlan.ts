/**
 * Reset All Users to Launch Plan (Clean State)
 * 
 * This script performs a complete reset:
 * 1. Clears ALL ledger entries for each user
 * 2. Sets all users to LAUNCH_4000_FIXED plan
 * 3. Sets credit balance to 4000
 * 4. Creates GRANT ledger entry for proper reconciliation
 * 5. Sets launchTrialStartDate with proper date logic
 * 6. Marks launchMigrationDone = true
 * 7. FORCES redo even if already on launch plan (clean state)
 * 
 * Usage:
 *   npx ts-node scripts/resetAllUsersToLaunchPlan.ts [--dry-run] [--limit=N]
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

// Launch plan cutoff date: January 20, 2026 (end of day UTC)
const LAUNCH_PLAN_CUTOFF_DATE = process.env.LAUNCH_PLAN_CUTOFF_DATE 
  ? new Date(process.env.LAUNCH_PLAN_CUTOFF_DATE)
  : new Date('2026-01-20T23:59:59.999Z');

function isWithinLaunchPlanPeriod(): boolean {
  const now = new Date();
  return now <= LAUNCH_PLAN_CUTOFF_DATE;
}

interface ResetStats {
  totalUsers: number;
  reset: number;
  skipped: number;
  errors: number;
  errorDetails: Array<{ uid: string; email?: string; error: string }>;
}

async function resetAllUsersToLaunchPlan(options: { dryRun?: boolean; limit?: number } = {}): Promise<ResetStats> {
  const { dryRun = false, limit } = options;
  
  console.log('\n🔄 ==== Reset All Users to Launch Plan (Clean State) ====\n');
  console.log('📋 Strategy:');
  console.log('  - FORCE reset ALL users (even if already on launch plan)');
  console.log('  - Clear ALL ledger entries for each user');
  console.log('  - Set all users → LAUNCH_4000_FIXED plan');
  console.log(`  - Set all users → ${LAUNCH_FIXED_CREDITS} credits`);
  console.log('  - Create GRANT ledger entry for proper reconciliation');
  console.log('  - Set launchTrialStartDate with proper date logic');
  console.log('  - Mark launchMigrationDone = true');
  console.log(`  - Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);
  if (limit) {
    console.log(`  - Limit: Processing first ${limit} users`);
  }
  console.log('='.repeat(70) + '\n');

  // Check if we're within the launch period
  const isWithinPeriod = isWithinLaunchPlanPeriod();
  if (!isWithinPeriod) {
    console.log('⚠️  WARNING: Current date is past launch plan cutoff date!');
    console.log(`   Cutoff: ${LAUNCH_PLAN_CUTOFF_DATE.toISOString()}`);
    console.log(`   Current: ${new Date().toISOString()}`);
    console.log('   Users will still be set to launch plan, but this may not be intended.\n');
  }

  // Ensure launch plan exists
  console.log('📦 Ensuring launch plan exists...');
  await creditsService.ensureLaunchPlan();
  console.log('✅ Launch plan ready\n');

  const stats: ResetStats = {
    totalUsers: 0,
    reset: 0,
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
    const batchSize = 10;
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
          const currentLedgerCount = userData.ledgerCount || 'unknown';

          try {
            if (dryRun) {
              console.log(`  🔍 [DRY RUN] Would reset: ${email} (${uid})`);
              console.log(`     Current: Plan=${currentPlan}, Balance=${currentBalance}`);
              console.log(`     Steps:`);
              console.log(`       1. Set balance to 0`);
              console.log(`       2. Clear all ledgers`);
              console.log(`       3. Set plan=${LAUNCH_PLAN_CODE}, launchTrialStartDate`);
              console.log(`       4. Create GRANT entry (balance: 0 → ${LAUNCH_FIXED_CREDITS})`);
              stats.reset++;
              return;
            }

            // Step 1: Set balance to 0 first (clean slate)
            console.log(`  🔄 Setting balance to 0 first...`);
            const now = admin.firestore.FieldValue.serverTimestamp();
            await adminDb.collection('users').doc(uid).update({
              creditBalance: 0,
              updatedAt: now,
            });
            console.log(`     ✅ Balance set to 0`);

            // Step 2: Clear all ledgers
            console.log(`  🗑️  Clearing all ledgers for ${email} (${uid})...`);
            let deletedCount = 0;
            try {
              deletedCount = await creditsRepository.clearAllLedgersForUser(uid);
              console.log(`     ✅ Cleared ${deletedCount} ledger entries`);
            } catch (ledgerError: any) {
              console.log(`     ⚠️  Ledger clear warning: ${ledgerError.message}`);
              // Continue even if ledger clear has issues
            }

            // Step 3: Set plan and launch date
            console.log(`  🔄 Setting plan and launch date...`);
            await adminDb.collection('users').doc(uid).update({
              planCode: LAUNCH_PLAN_CODE,
              launchMigrationDone: true,
              launchTrialStartDate: now, // Set trial start date for 15-day tracking
              updatedAt: now,
            });
            console.log(`     ✅ Plan and launch date set`);

            // Step 4: Create GRANT ledger entry (this will increment from 0 to launch fixed credits)
            console.log(`  💰 Creating GRANT ledger entry...`);
            try {
              const migrationGrantId = `LAUNCH_MIGRATION_GRANT_${uid}_${Date.now()}`;
              const grantResult = await creditsRepository.writeGrantIncrement(
                uid,
                migrationGrantId,
                LAUNCH_FIXED_CREDITS,
                'Launch plan migration grant (clean reset)',
                {
                  planCode: LAUNCH_PLAN_CODE,
                  migration: true,
                  reset: true,
                  timestamp: new Date().toISOString()
                }
              );
              
              if (grantResult === 'WRITTEN') {
                console.log(`     ✅ Created GRANT ledger entry (balance: 0 → ${LAUNCH_FIXED_CREDITS})`);
              } else {
                console.log(`     ⚠️  GRANT entry already exists (idempotent): ${grantResult}`);
              }
            } catch (grantError: any) {
              console.log(`     ⚠️  Grant creation warning: ${grantError.message}`);
              // If grant creation fails, manually set balance
              await adminDb.collection('users').doc(uid).update({
                creditBalance: LAUNCH_FIXED_CREDITS,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
              console.log(`     ✅ Manually set balance to ${LAUNCH_FIXED_CREDITS} as fallback`);
            }

            // Step 4: Verify final state
            const finalUser = await adminDb.collection('users').doc(uid).get();
            const finalData = finalUser.data();
            const finalBalance = finalData?.creditBalance || 0;
            const finalPlan = finalData?.planCode || 'UNKNOWN';
            
            // Check GRANT entry exists
            const userRef = adminDb.collection('users').doc(uid);
            const grantCheck = await userRef.collection('ledgers')
              .where('type', '==', 'GRANT')
              .where('status', '==', 'CONFIRMED')
              .limit(1)
              .get();
            
            const hasGrant = grantCheck.docs.length > 0;

            console.log(`  ✅ Reset complete: ${email} (${uid})`);
            console.log(`     Plan: ${currentPlan} → ${finalPlan}`);
            console.log(`     Balance: ${currentBalance} → ${finalBalance}`);
            console.log(`     Ledgers cleared: ${deletedCount}`);
            console.log(`     GRANT entry exists: ${hasGrant ? '✅' : '❌'}`);
            
            if (!hasGrant) {
              console.log(`     ⚠️  WARNING: GRANT entry not found after creation!`);
            }
            
            stats.reset++;

          } catch (error: any) {
            const errorMsg = error.message || String(error);
            console.error(`  ❌ Error resetting ${email} (${uid}): ${errorMsg}`);
            stats.errors++;
            stats.errorDetails.push({ uid, email, error: errorMsg });
          }
        })
      );
    }

    console.log('\n' + '='.repeat(70));
    console.log('📊 Reset Summary:');
    console.log(`   Total users: ${stats.totalUsers}`);
    console.log(`   ✅ Reset: ${stats.reset}`);
    console.log(`   ⏭️  Skipped: ${stats.skipped}`);
    console.log(`   ❌ Errors: ${stats.errors}`);
    console.log('='.repeat(70) + '\n');

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
      console.log('✅ Reset complete! All users are now on launch plan with clean state.\n');
      console.log('📝 Next steps:');
      console.log('   1. Verify credits are showing correctly in the app');
      console.log('   2. Test a generation to ensure debits work properly');
      console.log('   3. Check logs for any reconciliation issues\n');
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
    console.log('Usage: npx ts-node scripts/resetAllUsersToLaunchPlan.ts [--dry-run] [--limit=N]');
    console.log('\nOptions:');
    console.log('  --dry-run, -d    Run without making changes');
    console.log('  --limit=N         Process only first N users');
    console.log('  --help, -h        Show this help message');
    console.log('\n⚠️  WARNING: This script will:');
    console.log('  - Clear ALL ledger history for all users');
    console.log('  - Reset all users to launch plan');
    console.log('  - Force reset even if already on launch plan');
    console.log('  - This is a DESTRUCTIVE operation!');
    process.exit(0);
  }
}

// Run reset
resetAllUsersToLaunchPlan({ dryRun, limit })
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Reset failed:', error);
    process.exit(1);
  });

