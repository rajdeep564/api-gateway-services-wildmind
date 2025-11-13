# Credit System Issue Analysis & Solution

## Problem Statement
User credits are stuck at **4019** instead of the expected **4120** (FREE plan credits). The monthly rollback is not working as expected.

## Root Cause Analysis

### 1. **Current Monthly Reroll System**
Located in `src/services/creditsService.ts`:

```typescript
async ensureMonthlyReroll(uid: string) {
  // Compute current cycle key in UTC (YYYY-MM)
  const now = new Date();
  const cycle = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const reqId = `PLAN_MONTHLY_RESET_${cycle}`;
  
  // Execute idempotent GRANT that overwrites balance to the plan credits
  await creditsRepository.writeGrantAndSetPlanIfAbsent(
    uid,
    reqId,
    planCredits,
    planCode,
    'plan.monthly_reroll',
    { cycle, pricingVersion: 'plans-v1' }
  );
}
```

**Key Points:**
- Uses `PLAN_MONTHLY_RESET_${YYYY-MM}` as the idempotency key
- Called via `makeCreditCost()` middleware before EVERY generation
- Should overwrite balance to plan credits (4120 for FREE)
- Idempotent - only runs once per month per user

### 2. **When is Monthly Reroll Triggered?**
Located in `src/middlewares/creditCostFactory.ts`:

```typescript
export function makeCreditCost(provider: string, operation: string, computeCost: CostComputer) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Ensure user doc exists then perform monthly reroll (idempotent)
    await creditsService.ensureUserInit(uid);
    await creditsService.ensureMonthlyReroll(uid);  // ← Called here!
    
    const creditBalance = await creditsRepository.readUserCredits(uid);
    // ... credit validation logic
  };
}
```

**Triggered on EVERY generation request:**
- BFL image generation
- MiniMax video/image/music
- Runway video
- FAL image/video
- Replicate models (WAN, Kling, Seedance, etc.)

### 3. **Potential Issues**

#### Issue #1: Race Condition
If multiple generations happen simultaneously at the start of a new month, there could be a race condition where:
1. Request A checks ledger - not found
2. Request B checks ledger - not found  
3. Request A creates reroll ledger
4. Request B also tries to create reroll ledger

**Mitigation:** Firestore transactions should prevent this, but worth checking.

#### Issue #2: Ledger Already Exists (Wrong Balance)
If a user's reroll ledger for the current month exists BUT their balance is wrong (4019 instead of 4120), the system will:
- Check if ledger exists → YES
- Skip reroll → Balance stays at 4019

**This is the most likely cause!**

#### Issue #3: User Balance Modified Outside Reroll
If credits were:
- Manually adjusted in Firestore
- Modified by a different process
- Affected by a bug in debit logic

The reroll might have already executed with the wrong plan credits.

### 4. **How Credits Get Stuck**

**Scenario:**
1. User starts with 4120 credits (FREE plan)
2. User generates content, uses 101 credits → 4019 credits remain
3. Month changes from November to December
4. First generation in December triggers `ensureMonthlyReroll()`
5. Reroll checks: Does `PLAN_MONTHLY_RESET_2025-12` exist? NO
6. Reroll executes: Sets balance to 4120 ✅
7. BUT... if there's a bug where:
   - Plan doc has wrong credits (4019 instead of 4120)
   - Or reroll was executed with old balance
   - Or transaction didn't complete
   
Result: Balance stuck at 4019

### 5. **Diagnostic Steps**

Run the debug script to check:
```bash
npx ts-node scripts/debugUserCredits.ts <USER_ID>
```

This will show:
- Current balance
- Plan code
- Expected plan credits
- Monthly reroll status for current cycle
- Recent ledger entries
- Calculated balance vs actual balance

## Solutions

### Solution 1: Force Reroll for Affected User
```bash
npx ts-node scripts/debugUserCredits.ts <USER_ID> --force-reroll
```

This will:
1. Delete the current month's reroll ledger entry
2. Execute `ensureMonthlyReroll()` again
3. Set balance to correct plan credits (4120)

### Solution 2: Fix Plan Document
If the FREE plan document has wrong credits:

```typescript
// scripts/fixFreePlanCredits.ts
import { adminDb } from '../src/config/firebaseAdmin';

async function fixFreePlan() {
  const planRef = adminDb.collection('plans').doc('FREE');
  await planRef.update({
    credits: 4120  // Correct FREE plan credits
  });
  console.log('✅ FREE plan updated to 4120 credits');
}

fixFreePlan();
```

### Solution 3: Add Validation in Monthly Reroll

Update `src/services/creditsService.ts`:

```typescript
async ensureMonthlyReroll(uid: string) {
  const user = await creditsRepository.readUserInfo(uid);
  const planCode = (user?.planCode as any) || 'FREE';
  
  // Get expected plan credits
  const planSnap = await adminDb.collection('plans').doc(planCode).get();
  const planData = planSnap.data();
  const expectedCredits = Number(planData?.credits);
  
  // Validate plan credits
  if (!expectedCredits || expectedCredits <= 0) {
    console.error(`Invalid plan credits for ${planCode}: ${expectedCredits}`);
    // Fallback to hardcoded values
    planCredits = planCode === 'FREE' ? 4120 : (PLAN_CREDITS as any)[planCode] ?? 0;
  } else {
    planCredits = expectedCredits;
  }
  
  // Log for debugging
  console.log(`Monthly reroll for ${uid}: ${planCode} plan = ${planCredits} credits`);
  
  // ... rest of reroll logic
}
```

### Solution 4: Add Balance Verification Endpoint

Create a new endpoint to check and fix discrepancies:

```typescript
// src/controllers/creditsController.ts
async function verifyBalance(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = req.uid;
    
    // Get current state
    const user = await creditsRepository.readUserInfo(uid);
    const planSnap = await adminDb.collection('plans').doc(user.planCode).get();
    const expectedCredits = planSnap.data()?.credits;
    
    // Check last reroll
    const now = new Date();
    const cycle = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const rerollId = `PLAN_MONTHLY_RESET_${cycle}`;
    const ledgerSnap = await adminDb
      .collection('users')
      .doc(uid)
      .collection('ledgers')
      .doc(rerollId)
      .get();
    
    return res.json({
      currentBalance: user.creditBalance,
      planCode: user.planCode,
      expectedPlanCredits: expectedCredits,
      rerollExecuted: ledgerSnap.exists,
      rerollCycle: cycle,
      discrepancy: expectedCredits !== user.creditBalance,
      suggestion: ledgerSnap.exists && expectedCredits !== user.creditBalance
        ? 'Reroll executed but balance incorrect - may need force reroll'
        : 'No reroll this month - will execute on next generation'
    });
  } catch (err) {
    next(err);
  }
}
```

## Prevention Measures

### 1. Add Logging
Add comprehensive logging in `ensureMonthlyReroll()`:

```typescript
console.log(`[REROLL] User: ${uid}, Cycle: ${cycle}, Plan: ${planCode}, Credits: ${planCredits}`);
```

### 2. Add Alerts
Monitor for discrepancies:
- Alert if user balance doesn't match plan credits after reroll
- Alert if reroll fails
- Track reroll execution count per month

### 3. Add Health Check
Create a cron job or scheduled function:
```typescript
// Check all users once per day
async function validateAllUserBalances() {
  const users = await adminDb.collection('users').get();
  
  for (const userDoc of users.docs) {
    const user = userDoc.data();
    const planSnap = await adminDb.collection('plans').doc(user.planCode).get();
    const expectedCredits = planSnap.data()?.credits;
    
    if (user.creditBalance !== expectedCredits) {
      console.warn(`⚠️  User ${userDoc.id} has ${user.creditBalance} but should have ${expectedCredits}`);
      // Optionally auto-fix or alert admin
    }
  }
}
```

### 4. Transaction Verification
Update `writeGrantAndSetPlanIfAbsent()` to verify the write:

```typescript
// After transaction
const verifySnap = await userRef.get();
const verifyData = verifySnap.data();
if (verifyData.creditBalance !== credits) {
  console.error(`Transaction completed but balance verification failed!`);
  // Retry or alert
}
```

## Testing Plan

1. **Test Monthly Reroll**
   ```bash
   # Test with actual user
   npx ts-node scripts/debugUserCredits.ts <USER_ID>
   
   # Force reroll to verify fix
   npx ts-node scripts/debugUserCredits.ts <USER_ID> --force-reroll
   ```

2. **Test Plan Credits**
   ```bash
   # Verify all plans have correct credits
   npx ts-node scripts/verifyPlanCredits.ts
   ```

3. **Test Race Conditions**
   - Simulate concurrent requests at month boundary
   - Verify only one reroll ledger is created
   - Verify balance is correct

## Immediate Action Required

1. **Run diagnostic on affected user:**
   ```bash
   npx ts-node scripts/debugUserCredits.ts <USER_ID>
   ```

2. **If balance is wrong, force reroll:**
   ```bash
   npx ts-node scripts/debugUserCredits.ts <USER_ID> --force-reroll
   ```

3. **Verify FREE plan document:**
   ```bash
   # Check Firestore: plans/FREE document
   # Ensure credits field = 4120
   ```

4. **Monitor logs for reroll execution**

5. **Add logging to production** to catch future issues

## Long-term Improvements

1. **Decouple reroll from generation flow**
   - Run reroll via Cloud Function on schedule
   - Don't rely on user generation to trigger it

2. **Add balance reconciliation**
   - Daily job to verify all balances match plans
   - Auto-fix or alert on discrepancies

3. **Add admin dashboard**
   - View user credits
   - View ledger history
   - Manually trigger rerolls
   - Adjust credits if needed

4. **Improve error handling**
   - Retry logic for failed transactions
   - Alert on transaction failures
   - Fallback to hardcoded plan values

## Files to Review

- `src/services/creditsService.ts` - Monthly reroll logic
- `src/repository/creditsRepository.ts` - Ledger transactions
- `src/middlewares/creditCostFactory.ts` - Where reroll is triggered
- `src/data/creditDistribution.ts` - Plan credit values
- Firestore collections:
  - `plans` - Plan documents with credit allocations
  - `users/{uid}` - User credit balance
  - `users/{uid}/ledgers` - Transaction history

## Conclusion

The credit system is stuck because:
1. Monthly reroll was executed (ledger exists)
2. But balance is wrong (4019 instead of 4120)
3. System is idempotent - won't re-run reroll for same month

**Fix:** Force reroll with `--force-reroll` flag to reset balance.

**Prevention:** Add logging, monitoring, and balance verification.
