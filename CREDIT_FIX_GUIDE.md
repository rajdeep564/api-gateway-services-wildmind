# 🔍 Credit System Issue - Quick Diagnosis & Fix

## ❌ **Problem**
Credits stuck at **4019** instead of **4120** (FREE plan). Monthly rollback not working.

## 🎯 **Root Cause**
The monthly credit reset (reroll) system is **idempotent** - it only runs once per month per user using a ledger ID like `PLAN_MONTHLY_RESET_2025-11`.

**What's happening:**
1. Reroll executed for current month → Ledger entry created
2. Balance set incorrectly to 4019 (should be 4120)
3. System checks: "Reroll already done this month" → Skips
4. **Result:** User stuck at 4019 until next month!

## 🔧 **Immediate Fix (Choose One)**

### Option 1: Force Reroll via Script (RECOMMENDED)
```bash
# Navigate to backend directory
cd api-gateway-services-wildmind

# Run diagnostic (check status)
npx ts-node scripts/debugUserCredits.ts <USER_ID>

# Force reset credits (if stuck)
npx ts-node scripts/debugUserCredits.ts <USER_ID> --force-reroll
```

**What this does:**
- Deletes current month's reroll ledger
- Re-executes monthly reset
- Sets balance to correct 4120 credits

### Option 2: Manual Firestore Fix
1. Open Firebase Console
2. Go to Firestore Database
3. Find: `users/<USER_ID>/ledgers/PLAN_MONTHLY_RESET_2025-11`
4. **Delete this document**
5. User's next generation will trigger reroll automatically

### Option 3: Direct Balance Update (Quick but not ideal)
```typescript
// One-time fix via Firebase Console or script
const userRef = adminDb.collection('users').doc('USER_ID');
await userRef.update({
  creditBalance: 4120,
  updatedAt: admin.firestore.FieldValue.serverTimestamp()
});
```

⚠️ **Warning:** Option 3 doesn't fix the underlying ledger issue.

## 📋 **Verify Plan Configuration**

First, ensure plans are configured correctly:

```bash
# Check all plans
npx ts-node scripts/verifyAndFixPlanCredits.ts

# Auto-fix if issues found
npx ts-node scripts/verifyAndFixPlanCredits.ts --fix
```

**Expected Plan Credits:**
- FREE: **4120** credits
- PLAN_A: 12,360 credits
- PLAN_B: 24,720 credits
- PLAN_C: 61,800 credits
- PLAN_D: 197,760 credits

## 📊 **How Monthly Reroll Works**

Located in: `src/services/creditsService.ts`

```typescript
async ensureMonthlyReroll(uid: string) {
  // 1. Get current month cycle (e.g., "2025-11")
  const cycle = `${year}-${month}`;
  const reqId = `PLAN_MONTHLY_RESET_${cycle}`;
  
  // 2. Check if reroll already done this month
  const existingLedger = await getLedger(uid, reqId);
  if (existingLedger.exists) {
    return; // ← SKIP if already done!
  }
  
  // 3. Set balance to plan credits (4120 for FREE)
  await setBalance(uid, planCredits);
}
```

**Triggered on every generation via:**
`src/middlewares/creditCostFactory.ts`

## 🐛 **Why It Got Stuck**

**Possible Causes:**

1. **Wrong Plan Credits in Firestore**
   - `plans/FREE` document has wrong `credits` field
   - Solution: Fix plan document

2. **Transaction Failed Mid-Execution**
   - Ledger created but balance not updated
   - Solution: Delete ledger, retry

3. **Manual Adjustment Gone Wrong**
   - Someone manually changed balance
   - Solution: Force reroll

4. **Race Condition (unlikely)**
   - Multiple requests at month boundary
   - Firestore transactions should prevent this

## 🔍 **Diagnostic Commands**

### Check User Credits
```bash
npx ts-node scripts/debugUserCredits.ts <USER_ID>
```

Shows:
- Current balance
- Plan code
- Expected credits
- Reroll status
- Recent transactions
- Balance discrepancies

### Check Plan Configuration
```bash
npx ts-node scripts/verifyAndFixPlanCredits.ts
```

Shows:
- All plan credits
- Missing plans
- Incorrect values

### Check Specific User in Firestore
```
Collection: users
Document: <USER_ID>
Fields:
  - creditBalance: 4019 (SHOULD BE 4120)
  - planCode: "FREE"
  - updatedAt: <timestamp>
```

```
Collection: users/<USER_ID>/ledgers
Document: PLAN_MONTHLY_RESET_2025-11
Fields:
  - type: "GRANT"
  - amount: 4019 (SHOULD BE 4120!)
  - reason: "plan.monthly_reroll"
  - status: "CONFIRMED"
  - createdAt: <timestamp>
```

## ✅ **Solution Steps (In Order)**

### Step 1: Verify Plan Credits
```bash
cd api-gateway-services-wildmind
npx ts-node scripts/verifyAndFixPlanCredits.ts --fix
```

### Step 2: Diagnose User
```bash
npx ts-node scripts/debugUserCredits.ts <USER_ID>
```

**Check output for:**
- "MISMATCH DETECTED" → Balance ≠ Plan Credits
- "No reroll found for 2025-11" → Reroll hasn't run yet
- "Reroll already executed" + wrong balance → Need force reset

### Step 3: Force Reset (if needed)
```bash
npx ts-node scripts/debugUserCredits.ts <USER_ID> --force-reroll
```

### Step 4: Verify Fix
```bash
npx ts-node scripts/debugUserCredits.ts <USER_ID>
```

Should show:
- ✅ Credit Balance: 4120
- ✅ Plan Code: FREE
- ✅ Reroll executed for current month
- ✅ Balance matches plan credits

## 🛡️ **Prevention (For Future)**

### 1. Add Logging
Update `src/services/creditsService.ts`:

```typescript
async ensureMonthlyReroll(uid: string) {
  console.log(`[REROLL] Starting for user ${uid}`);
  console.log(`[REROLL] Cycle: ${cycle}, Plan: ${planCode}, Credits: ${planCredits}`);
  
  // ... existing logic ...
  
  console.log(`[REROLL] Complete. New balance: ${planCredits}`);
}
```

### 2. Add Balance Verification
After reroll, verify the write succeeded:

```typescript
// After writeGrantAndSetPlanIfAbsent()
const verifyBalance = await creditsRepository.readUserCredits(uid);
if (verifyBalance !== planCredits) {
  console.error(`❌ Reroll verification failed! Expected ${planCredits}, got ${verifyBalance}`);
  // Alert or retry
}
```

### 3. Add Monthly Health Check
Create cron job to check all users:

```typescript
// Run daily at 3 AM
async function validateAllUsers() {
  const users = await getAllUsers();
  
  for (const user of users) {
    const expected = await getPlanCredits(user.planCode);
    if (user.creditBalance !== expected) {
      console.warn(`⚠️  User ${user.uid} has wrong balance: ${user.creditBalance} vs ${expected}`);
      // Auto-fix or alert admin
    }
  }
}
```

### 4. Add Admin Endpoint
Create API to check/fix credits:

```typescript
// POST /api/admin/credits/verify
// POST /api/admin/credits/force-reroll
```

## 📝 **Quick Reference**

### Scripts Created
1. `scripts/debugUserCredits.ts` - Diagnose user credits
2. `scripts/verifyAndFixPlanCredits.ts` - Check plan configuration

### Key Files
- `src/services/creditsService.ts` - Reroll logic
- `src/repository/creditsRepository.ts` - Ledger transactions
- `src/middlewares/creditCostFactory.ts` - Reroll trigger
- `src/data/creditDistribution.ts` - Plan values

### Firestore Structure
```
plans/
  FREE/ → { credits: 4120, ... }
  PLAN_A/ → { credits: 12360, ... }
  ...

users/
  <USER_ID>/ → { creditBalance: 4019, planCode: "FREE", ... }
    ledgers/
      PLAN_MONTHLY_RESET_2025-11/ → { type: "GRANT", amount: 4019, ... }
      <other transactions>
```

## 🚀 **Execute Now**

```bash
# 1. Navigate to backend
cd api-gateway-services-wildmind

# 2. Check what's wrong
npx ts-node scripts/debugUserCredits.ts <USER_ID>

# 3. Fix it
npx ts-node scripts/debugUserCredits.ts <USER_ID> --force-reroll

# 4. Verify fix worked
npx ts-node scripts/debugUserCredits.ts <USER_ID>
```

**Done! Credits should now be at 4120** ✅

---

## 💡 **Need User ID?**

Check in:
- Firebase Console → Authentication → Users
- Firestore → users collection
- Or from your auth system logs
