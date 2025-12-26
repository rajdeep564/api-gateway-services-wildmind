# Launch Plan Edge Cases Verification

## Cutoff Date: January 10, 2026, 23:59:59.999 UTC

## Edge Cases Test Matrix

### Case 1: User signs up on Dec 1, 2025
- **Backend Check**: `isWithinLaunchPlanPeriod()` = `true` (Dec 1 <= Jan 10) ✓
- **Plan Assigned**: `LAUNCH_4000_FIXED` ✓
- **Trial End Calculation**:
  - 15 days from Dec 1 = Dec 16, 2025
  - Cutoff date = Jan 10, 2026 23:59:59
  - Trial end = min(Dec 16, Jan 10) = **Dec 16, 2025** ✓
- **Timer Shows**: 15 days ✓

### Case 2: User signs up on Dec 25, 2025
- **Backend Check**: `isWithinLaunchPlanPeriod()` = `true` ✓
- **Plan Assigned**: `LAUNCH_4000_FIXED` ✓
- **Trial End Calculation**:
  - 15 days from Dec 25 = Jan 9, 2026
  - Cutoff date = Jan 10, 2026 23:59:59
  - Trial end = min(Jan 9, Jan 10) = **Jan 9, 2026** ✓
- **Timer Shows**: 15 days ✓

### Case 3: User signs up on Jan 1, 2026
- **Backend Check**: `isWithinLaunchPlanPeriod()` = `true` ✓
- **Plan Assigned**: `LAUNCH_4000_FIXED` ✓
- **Trial End Calculation**:
  - 15 days from Jan 1 = Jan 16, 2026
  - Cutoff date = Jan 10, 2026 23:59:59
  - Trial end = min(Jan 16, Jan 10) = **Jan 10, 2026 23:59:59** ✓
- **Timer Shows**: 9 days (until cutoff) ✓

### Case 4: User signs up on Jan 10, 2026 at 10:00 AM UTC
- **Backend Check**: `isWithinLaunchPlanPeriod()` = `true` (Jan 10 10:00 <= Jan 10 23:59) ✓
- **Plan Assigned**: `LAUNCH_4000_FIXED` ✓
- **Trial End Calculation**:
  - 15 days from Jan 10 10:00 = Jan 25, 2026 10:00
  - Cutoff date = Jan 10, 2026 23:59:59
  - Trial end = min(Jan 25, Jan 10 23:59) = **Jan 10, 2026 23:59:59** ✓
- **Timer Shows**: ~14 hours (until end of cutoff day) ✓

### Case 5: User signs up on Jan 10, 2026 at 11:59 PM UTC
- **Backend Check**: `isWithinLaunchPlanPeriod()` = `true` (Jan 10 23:59 <= Jan 10 23:59) ✓
- **Plan Assigned**: `LAUNCH_4000_FIXED` ✓
- **Trial End Calculation**:
  - 15 days from Jan 10 23:59 = Jan 25, 2026 23:59
  - Cutoff date = Jan 10, 2026 23:59:59
  - Trial end = min(Jan 25, Jan 10 23:59) = **Jan 10, 2026 23:59:59** ✓
- **Timer Shows**: ~1 minute (until end of cutoff day) ✓

### Case 6: User signs up on Jan 11, 2026 (AFTER cutoff)
- **Backend Check**: `isWithinLaunchPlanPeriod()` = `false` (Jan 11 > Jan 10) ✓
- **Plan Assigned**: `FREE` (2000 credits) ✓
- **Trial End**: N/A (not on launch plan) ✓
- **Timer Shows**: N/A (not on launch plan) ✓

### Case 7: User signs up on Jan 9, 2026 at 11:59 PM UTC
- **Backend Check**: `isWithinLaunchPlanPeriod()` = `true` ✓
- **Plan Assigned**: `LAUNCH_4000_FIXED` ✓
- **Trial End Calculation**:
  - 15 days from Jan 9 23:59 = Jan 24, 2026 23:59
  - Cutoff date = Jan 10, 2026 23:59:59
  - Trial end = min(Jan 24, Jan 10 23:59) = **Jan 10, 2026 23:59:59** ✓
- **Timer Shows**: ~24 hours (until end of cutoff day) ✓

## Backend Logic Verification

### `isWithinLaunchPlanPeriod()`
```typescript
function isWithinLaunchPlanPeriod(): boolean {
  const now = new Date();
  return now <= LAUNCH_PLAN_CUTOFF_DATE; // Jan 10, 2026 23:59:59.999 UTC
}
```
- ✅ Returns `true` for any time on or before Jan 10, 2026 23:59:59.999 UTC
- ✅ Returns `false` for any time after Jan 10, 2026 23:59:59.999 UTC

### Trial Expiration Check
```typescript
const isPastCutoff = now > LAUNCH_PLAN_CUTOFF_DATE;
const is15DaysPassed = daysSinceStart >= 15;
if (is15DaysPassed || isPastCutoff) {
  // Switch to FREE plan
}
```
- ✅ Expires if 15 days passed OR past cutoff date
- ✅ Handles both conditions correctly

## Frontend Timer Logic Verification

### Trial End Date Calculation
```typescript
const cutoffDate = new Date('2026-01-10T23:59:59.999Z');
const trialEndDate15Days = new Date(trialStartDate);
trialEndDate15Days.setDate(trialEndDate15Days.getDate() + 15);
const trialEndDate = trialEndDate15Days.getTime() <= cutoffDate.getTime() 
  ? trialEndDate15Days 
  : cutoffDate;
```
- ✅ Uses whichever comes first: 15 days OR cutoff date
- ✅ Correctly handles edge case where user signs up on cutoff day

## Summary

✅ **All edge cases are handled correctly:**
1. Users signing up before Dec 26 get full 15 days
2. Users signing up Dec 26-Jan 9 get until cutoff date (Jan 10)
3. Users signing up on Jan 10 get until end of day (23:59:59 UTC)
4. Users signing up after Jan 10 get FREE plan (not launch plan)
5. Timer correctly shows time remaining until the earlier of: 15 days or cutoff date

