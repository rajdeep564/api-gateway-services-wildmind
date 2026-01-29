# Launch Plan Edge Cases Verification

## Cutoff Date: February 20, 2026, 23:59:59.999 UTC

## Edge Cases Test Matrix

### Case 1: User signs up on Dec 1, 2025
- **Backend Check**: `isWithinLaunchPlanPeriod()` = `true` (Dec 1 <= Feb 20) ✓
- **Plan Assigned**: `LAUNCH_4000_FIXED` ✓
- **Trial End Calculation**:
  - 15 days from Dec 1 = Dec 16, 2025
  - Cutoff date = Feb 20, 2026 23:59:59
  - Trial end = min(Dec 16, Feb 20) = **Dec 16, 2025** ✓
- **Timer Shows**: 15 days ✓

### Case 2: User signs up on Dec 25, 2025
- **Backend Check**: `isWithinLaunchPlanPeriod()` = `true` ✓
- **Plan Assigned**: `LAUNCH_4000_FIXED` ✓
- **Trial End Calculation**:
  - 15 days from Dec 25 = Jan 9, 2026
  - Cutoff date = Feb 20, 2026 23:59:59
  - Trial end = min(Jan 9, Feb 20) = **Jan 9, 2026** ✓
- **Timer Shows**: 15 days ✓

### Case 3: User signs up on Feb 10, 2026
- **Backend Check**: `isWithinLaunchPlanPeriod()` = `true` ✓
- **Plan Assigned**: `LAUNCH_4000_FIXED` ✓
- **Trial End Calculation**:
  - 15 days from Feb 10 = Feb 25, 2026
  - Cutoff date = Feb 20, 2026 23:59:59
  - Trial end = min(Feb 25, Feb 20) = **Feb 20, 2026 23:59:59** ✓
- **Timer Shows**: 10 days (until cutoff) ✓

### Case 4: User signs up on Feb 20, 2026 at 10:00 AM UTC
- **Backend Check**: `isWithinLaunchPlanPeriod()` = `true` (Feb 20 10:00 <= Feb 20 23:59) ✓
- **Plan Assigned**: `LAUNCH_4000_FIXED` ✓
- **Trial End Calculation**:
  - 15 days from Feb 20 10:00 = Mar 7, 2026 10:00
  - Cutoff date = Feb 20, 2026 23:59:59
  - Trial end = min(Mar 7, Feb 20 23:59) = **Feb 20, 2026 23:59:59** ✓
- **Timer Shows**: ~14 hours (until end of cutoff day) ✓

### Case 5: User signs up on Feb 20, 2026 at 11:59 PM UTC
- **Backend Check**: `isWithinLaunchPlanPeriod()` = `true` (Feb 20 23:59 <= Feb 20 23:59) ✓
- **Plan Assigned**: `LAUNCH_4000_FIXED` ✓
- **Trial End Calculation**:
  - 15 days from Feb 20 23:59 = Mar 7, 2026 23:59
  - Cutoff date = Feb 20, 2026 23:59:59
  - Trial end = min(Mar 7, Feb 20 23:59) = **Feb 20, 2026 23:59:59** ✓
- **Timer Shows**: ~1 minute (until end of cutoff day) ✓

### Case 6: User signs up on Feb 21, 2026 (AFTER cutoff)
- **Backend Check**: `isWithinLaunchPlanPeriod()` = `false` (Feb 21 > Feb 20) ✓
- **Plan Assigned**: `FREE` (2000 credits) ✓
- **Trial End**: N/A (not on launch plan) ✓
- **Timer Shows**: N/A (not on launch plan) ✓

### Case 7: User signs up on Feb 19, 2026 at 11:59 PM UTC
- **Backend Check**: `isWithinLaunchPlanPeriod()` = `true` ✓
- **Plan Assigned**: `LAUNCH_4000_FIXED` ✓
- **Trial End Calculation**:
  - 15 days from Feb 19 23:59 = Mar 6, 2026 23:59
  - Cutoff date = Feb 20, 2026 23:59:59
  - Trial end = min(Mar 6, Feb 20 23:59) = **Feb 20, 2026 23:59:59** ✓
- **Timer Shows**: ~24 hours (until end of cutoff day) ✓

## Backend Logic Verification

### `isWithinLaunchPlanPeriod()`
```typescript
function isWithinLaunchPlanPeriod(): boolean {
  const now = new Date();
  return now <= LAUNCH_PLAN_CUTOFF_DATE; // Feb 20, 2026 23:59:59.999 UTC
}
```
- ✅ Returns `true` for any time on or before Feb 20, 2026 23:59:59.999 UTC
- ✅ Returns `false` for any time after Feb 20, 2026 23:59:59.999 UTC

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
const cutoffDate = new Date('2026-02-20T23:59:59.999Z');
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
1. Users signing up before Feb 5 get full 15 days
2. Users signing up Feb 5-Feb 19 get until cutoff date (Feb 20)
3. Users signing up on Feb 20 get until end of day (23:59:59 UTC)
4. Users signing up after Feb 20 get FREE plan (not launch plan)
5. Timer correctly shows time remaining until the earlier of: 15 days or cutoff date

