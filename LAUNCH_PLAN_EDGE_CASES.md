# Launch Plan Edge Cases Verification

## Cutoff Date: December 25, 2025, 23:59:59.999 UTC

## Edge Cases Test Matrix

### Case 1: User signs up on Dec 1, 2025
- **Backend Check**: `isWithinLaunchPlanPeriod()` = `true` (Dec 1 <= Dec 25) ✓
- **Plan Assigned**: `LAUNCH_4000_FIXED` ✓
- **Trial End Calculation**:
  - 15 days from Dec 1 = Dec 16, 2025
  - Cutoff date = Dec 25, 2025 23:59:59
  - Trial end = min(Dec 16, Dec 25) = **Dec 16, 2025** ✓
- **Timer Shows**: 15 days ✓

### Case 2: User signs up on Dec 10, 2025
- **Backend Check**: `isWithinLaunchPlanPeriod()` = `true` ✓
- **Plan Assigned**: `LAUNCH_4000_FIXED` ✓
- **Trial End Calculation**:
  - 15 days from Dec 10 = Dec 25, 2025
  - Cutoff date = Dec 25, 2025 23:59:59
  - Trial end = min(Dec 25, Dec 25) = **Dec 25, 2025 23:59:59** ✓
- **Timer Shows**: 15 days (until cutoff) ✓

### Case 3: User signs up on Dec 15, 2025
- **Backend Check**: `isWithinLaunchPlanPeriod()` = `true` ✓
- **Plan Assigned**: `LAUNCH_4000_FIXED` ✓
- **Trial End Calculation**:
  - 15 days from Dec 15 = Dec 30, 2025
  - Cutoff date = Dec 25, 2025 23:59:59
  - Trial end = min(Dec 30, Dec 25) = **Dec 25, 2025 23:59:59** ✓
- **Timer Shows**: 10 days (until cutoff) ✓

### Case 4: User signs up on Dec 25, 2025 at 10:00 AM UTC
- **Backend Check**: `isWithinLaunchPlanPeriod()` = `true` (Dec 25 10:00 <= Dec 25 23:59) ✓
- **Plan Assigned**: `LAUNCH_4000_FIXED` ✓
- **Trial End Calculation**:
  - 15 days from Dec 25 10:00 = Jan 9, 2026 10:00
  - Cutoff date = Dec 25, 2025 23:59:59
  - Trial end = min(Jan 9, Dec 25 23:59) = **Dec 25, 2025 23:59:59** ✓
- **Timer Shows**: ~14 hours (until end of cutoff day) ✓

### Case 5: User signs up on Dec 25, 2025 at 11:59 PM UTC
- **Backend Check**: `isWithinLaunchPlanPeriod()` = `true` (Dec 25 23:59 <= Dec 25 23:59) ✓
- **Plan Assigned**: `LAUNCH_4000_FIXED` ✓
- **Trial End Calculation**:
  - 15 days from Dec 25 23:59 = Jan 9, 2026 23:59
  - Cutoff date = Dec 25, 2025 23:59:59
  - Trial end = min(Jan 9, Dec 25 23:59) = **Dec 25, 2025 23:59:59** ✓
- **Timer Shows**: ~1 minute (until end of cutoff day) ✓

### Case 6: User signs up on Dec 26, 2025 (AFTER cutoff)
- **Backend Check**: `isWithinLaunchPlanPeriod()` = `false` (Dec 26 > Dec 25) ✓
- **Plan Assigned**: `FREE` (2000 credits) ✓
- **Trial End**: N/A (not on launch plan) ✓
- **Timer Shows**: N/A (not on launch plan) ✓

### Case 7: User signs up on Dec 24, 2025 at 11:59 PM UTC
- **Backend Check**: `isWithinLaunchPlanPeriod()` = `true` ✓
- **Plan Assigned**: `LAUNCH_4000_FIXED` ✓
- **Trial End Calculation**:
  - 15 days from Dec 24 23:59 = Jan 8, 2026 23:59
  - Cutoff date = Dec 25, 2025 23:59:59
  - Trial end = min(Jan 8, Dec 25 23:59) = **Dec 25, 2025 23:59:59** ✓
- **Timer Shows**: ~24 hours (until end of cutoff day) ✓

## Backend Logic Verification

### `isWithinLaunchPlanPeriod()`
```typescript
function isWithinLaunchPlanPeriod(): boolean {
  const now = new Date();
  return now <= LAUNCH_PLAN_CUTOFF_DATE; // Dec 25, 2025 23:59:59.999 UTC
}
```
- ✅ Returns `true` for any time on or before Dec 25, 2025 23:59:59.999 UTC
- ✅ Returns `false` for any time after Dec 25, 2025 23:59:59.999 UTC

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
const cutoffDate = new Date('2025-12-25T23:59:59.999Z');
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
1. Users signing up before Dec 10 get full 15 days
2. Users signing up Dec 10-24 get until cutoff date (Dec 25)
3. Users signing up on Dec 25 get until end of day (23:59:59 UTC)
4. Users signing up after Dec 25 get FREE plan (not launch plan)
5. Timer correctly shows time remaining until the earlier of: 15 days or cutoff date

