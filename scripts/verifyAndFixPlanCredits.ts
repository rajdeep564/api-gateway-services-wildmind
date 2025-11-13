/**
 * Verify and Fix Plan Credits
 * 
 * This script:
 * 1. Checks all plan documents in Firestore
 * 2. Verifies credits match expected values
 * 3. Optionally fixes incorrect values
 * 
 * Usage:
 *   npx ts-node scripts/verifyAndFixPlanCredits.ts [--fix]
 */

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { adminDb, admin } from '../src/config/firebaseAdmin';
import { PLAN_CREDITS } from '../src/data/creditDistribution';

const EXPECTED_PLAN_CREDITS = {
  FREE: 4120,
  PLAN_A: PLAN_CREDITS.PLAN_A,
  PLAN_B: PLAN_CREDITS.PLAN_B,
  PLAN_C: PLAN_CREDITS.PLAN_C,
  PLAN_D: PLAN_CREDITS.PLAN_D,
};

async function verifyAndFixPlans(fix: boolean = false) {
  console.log('\n🔍 ==== Plan Credits Verification ====\n');
  console.log(fix ? 'Mode: FIX ENABLED' : 'Mode: CHECK ONLY (use --fix to apply changes)');
  console.log('-----------------------------------\n');

  const issues: string[] = [];
  const fixes: string[] = [];

  try {
    for (const [planCode, expectedCredits] of Object.entries(EXPECTED_PLAN_CREDITS)) {
      console.log(`📋 Checking ${planCode} plan...`);
      
      const planRef = adminDb.collection('plans').doc(planCode);
      const planSnap = await planRef.get();

      if (!planSnap.exists) {
        console.log(`   ❌ Plan document does NOT exist!`);
        issues.push(`${planCode}: Document missing`);
        
        if (fix) {
          console.log(`   🔧 Creating ${planCode} plan document...`);
          await planRef.set({
            code: planCode,
            name: planCode === 'FREE' ? 'Free' : planCode.replace('_', ' '),
            credits: expectedCredits,
            priceInPaise: 0,
            active: planCode === 'FREE',
            sort: Object.keys(EXPECTED_PLAN_CREDITS).indexOf(planCode),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log(`   ✅ Created with ${expectedCredits} credits`);
          fixes.push(`${planCode}: Created with ${expectedCredits} credits`);
        }
      } else {
        const planData = planSnap.data();
        const actualCredits = Number(planData?.credits);
        
        console.log(`   Current credits: ${actualCredits}`);
        console.log(`   Expected credits: ${expectedCredits}`);
        
        if (actualCredits !== expectedCredits) {
          console.log(`   ❌ MISMATCH! Off by ${expectedCredits - actualCredits} credits`);
          issues.push(`${planCode}: Has ${actualCredits}, should have ${expectedCredits}`);
          
          if (fix) {
            console.log(`   🔧 Updating credits to ${expectedCredits}...`);
            await planRef.update({
              credits: expectedCredits,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            console.log(`   ✅ Fixed!`);
            fixes.push(`${planCode}: Updated ${actualCredits} → ${expectedCredits}`);
          }
        } else {
          console.log(`   ✅ Correct!`);
        }
      }
      console.log('');
    }

    // Summary
    console.log('\n===================================');
    console.log('📊 Summary');
    console.log('===================================\n');
    
    if (issues.length === 0) {
      console.log('✅ All plans are correct!');
    } else {
      console.log(`⚠️  Found ${issues.length} issue(s):\n`);
      issues.forEach(issue => console.log(`   - ${issue}`));
      console.log('');
    }

    if (fix && fixes.length > 0) {
      console.log(`🔧 Applied ${fixes.length} fix(es):\n`);
      fixes.forEach(fixMsg => console.log(`   ✓ ${fixMsg}`));
      console.log('');
    } else if (!fix && issues.length > 0) {
      console.log('💡 Run with --fix to automatically correct these issues');
      console.log('   npx ts-node scripts/verifyAndFixPlanCredits.ts --fix\n');
    }

  } catch (error) {
    console.error('\n❌ Error during verification:', error);
    throw error;
  }

  console.log('===================================\n');
}

// Parse command line arguments
const args = process.argv.slice(2);
const fix = args.includes('--fix');

// Run the script
verifyAndFixPlans(fix)
  .then(() => {
    console.log('✅ Verification complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  });
