/**
 * Bulk Migration: Clear All Ledgers and Move All Users to Launch Plan
 * 
 * This script:
 * 1. Clears all ledger entries for each user
 * 2. Sets all users to LAUNCH_4000_FIXED plan
 * 3. Sets credit balance to 4000
 * 4. Marks launchMigrationDone = true
 * 5. Sets launchTrialStartDate for 15-day trial tracking
 * 6. Fixes users already on launch plan but missing trial start date
 * 
 * Usage:
 *   npx ts-node scripts/migrateAllUsersToLaunchPlan.ts [--dry-run] [--limit=N]
 */

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { adminDb, admin } from '../src/config/firebaseAdmin';
import { creditsRepository } from '../src/repository/creditsRepository';
import { creditsService } from '../src/services/creditsService';

const LAUNCH_PLAN_CODE = 'LAUNCH_4000_FIXED';
const LAUNCH_FIXED_CREDITS = 4000;

interface MigrationStats {
  totalUsers: number;
  migrated: number;
  skipped: number;
  errors: number;
  errorDetails: Array<{ uid: string; email?: string; error: string }>;
}

async function migrateAllUsersToLaunchPlan(options: { dryRun?: boolean; limit?: number } = {}): Promise<MigrationStats> {
  const { dryRun = false, limit } = options;
  
  console.log('\n🚀 ==== Launch Plan Bulk Migration ====\n');
  console.log('📋 Strategy:');
  console.log('  - All users → LAUNCH_4000_FIXED plan');
  console.log('  - All users → 4000 credits (fixed, no daily reset)');
  console.log('  - Clear ALL ledger history for each user');
  console.log('  - Mark launchMigrationDone = true');
  console.log('  - Set launchTrialStartDate for 15-day trial tracking');
  console.log('  - Fix users already on launch plan but missing trial start date');
  console.log(`  - Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);
  if (limit) {
    console.log(`  - Limit: Processing first ${limit} users`);
  }
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
          const alreadyMigrated = Boolean(userData.launchMigrationDone);
          const hasTrialStartDate = Boolean(userData.launchTrialStartDate);

          try {
            if (alreadyMigrated && !dryRun) {
              // Already migrated - check if plan is correct and trial start date exists
              const needsUpdate: any = {};
              let needsUpdateFlag = false;

              if (currentPlan !== LAUNCH_PLAN_CODE) {
                console.log(`  ⚠️  ${email} (${uid}): Already migrated but wrong plan (${currentPlan}), fixing...`);
                needsUpdate.planCode = LAUNCH_PLAN_CODE;
                needsUpdateFlag = true;
              }

              if (!hasTrialStartDate) {
                console.log(`  ⚠️  ${email} (${uid}): Missing launchTrialStartDate, setting it now...`);
                needsUpdate.launchTrialStartDate = admin.firestore.FieldValue.serverTimestamp();
                needsUpdateFlag = true;
              }

              if (needsUpdateFlag) {
                needsUpdate.updatedAt = admin.firestore.FieldValue.serverTimestamp();
                await adminDb.collection('users').doc(uid).update(needsUpdate);
                console.log(`     ✅ Updated: ${Object.keys(needsUpdate).join(', ')}`);
                stats.migrated++;
              } else {
                stats.skipped++;
              }
              return;
            }

            // Also check if user is on launch plan but missing trial start date (edge case)
            if (currentPlan === LAUNCH_PLAN_CODE && !hasTrialStartDate && !dryRun) {
              console.log(`  ⚠️  ${email} (${uid}): On launch plan but missing launchTrialStartDate, setting it...`);
              await adminDb.collection('users').doc(uid).update({
                launchTrialStartDate: admin.firestore.FieldValue.serverTimestamp(),
                launchMigrationDone: true, // Also mark as migrated
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
              console.log(`     ✅ Set launchTrialStartDate and launchMigrationDone`);
              stats.migrated++;
              return;
            }

            if (dryRun) {
              console.log(`  🔍 [DRY RUN] Would migrate: ${email} (${uid})`);
              console.log(`     Current: Plan=${currentPlan}, Balance=${currentBalance}, Migrated=${alreadyMigrated}, HasTrialDate=${hasTrialStartDate}`);
              console.log(`     Would set: Plan=${LAUNCH_PLAN_CODE}, Balance=${LAUNCH_FIXED_CREDITS}, launchTrialStartDate=<now>, Clear ledgers`);
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

            // Update user to launch plan
            console.log(`  🔄 Setting ${email} to launch plan...`);
            await adminDb.collection('users').doc(uid).update({
              planCode: LAUNCH_PLAN_CODE,
              creditBalance: LAUNCH_FIXED_CREDITS,
              launchMigrationDone: true,
              launchTrialStartDate: admin.firestore.FieldValue.serverTimestamp(), // Set trial start date for 15-day tracking
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            
            // CRITICAL FIX: Create GRANT ledger entry so reconciliation works correctly
            console.log(`  💰 Creating migration GRANT ledger entry...`);
            try {
              const migrationGrantId = `LAUNCH_MIGRATION_GRANT_${uid}`;
              const grantResult = await creditsRepository.writeGrantIncrement(
                uid, 
                migrationGrantId, 
                LAUNCH_FIXED_CREDITS, 
                'Launch plan migration grant', 
                {
                  planCode: LAUNCH_PLAN_CODE,
                  migration: true,
                  timestamp: new Date().toISOString()
                }
              );
              console.log(`     ✅ Created GRANT ledger entry: ${grantResult}`);
            } catch (grantError: any) {
              console.log(`     ⚠️  Grant creation warning: ${grantError.message}`);
              // Continue even if grant creation has issues (balance is already set)
            }

            console.log(`  ✅ Migrated: ${email} (${uid})`);
            console.log(`     Plan: ${currentPlan} → ${LAUNCH_PLAN_CODE}`);
            console.log(`     Balance: ${currentBalance} → ${LAUNCH_FIXED_CREDITS}`);
            console.log(`     Ledgers cleared: ${deletedCount}`);
            stats.migrated++;

          } catch (error: any) {
            const errorMsg = error.message || String(error);
            console.error(`  ❌ Error migrating ${email} (${uid}): ${errorMsg}`);
            stats.errors++;
            stats.errorDetails.push({ uid, email, error: errorMsg });
          }
        })
      );
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Migration Summary:');
    console.log(`   Total users: ${stats.totalUsers}`);
    console.log(`   ✅ Migrated: ${stats.migrated}`);
    console.log(`   ⏭️  Skipped: ${stats.skipped}`);
    console.log(`   ❌ Errors: ${stats.errors}`);
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
      console.log('✅ Migration complete!\n');
    }

  } catch (error) {
    console.error('\n❌ Fatal error during migration:', error);
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
    console.log('Usage: npx ts-node scripts/migrateAllUsersToLaunchPlan.ts [--dry-run] [--limit=N]');
    console.log('\nOptions:');
    console.log('  --dry-run, -d    Run without making changes');
    console.log('  --limit=N         Process only first N users');
    console.log('  --help, -h        Show this help message');
    process.exit(0);
  }
}

// Run migration
migrateAllUsersToLaunchPlan({ dryRun, limit })
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  });

