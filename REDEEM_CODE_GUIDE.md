# Redeem Code System Guide

## Overview
The redeem code system allows users to get upgraded plans during signup by entering special codes.

## Plan Types
- **Student Plan (PLAN_A)**: 12,360 credits
- **Business Plan (PLAN_B)**: 24,720 credits
- **Free Plan**: 4,120 credits (default)

## How to Generate Codes

### For Testing (Quick Setup)
```bash
cd api-gateway-services
node generateTestCodes.js
```

This generates:
- 1 Student code (can be used 10 times)
- 1 Business code (can be used 10 times)

### For Production (Full Setup)
```bash
cd api-gateway-services
node generateRedeemCodes.js
```

This generates:
- 70 Student codes (1 use each)
- 50 Business codes (1 use each)

## Current Test Codes
**Student Code**: `STU-335052-MV9TOI`
**Business Code**: `BUS-335483-PRLKHW`

## How It Works

### Frontend Flow
1. User completes signup (email verification + username)
2. Redeem code screen appears (optional step)
3. User can enter a code or skip
4. If code is valid, user gets upgraded plan
5. User is redirected to home page

### Backend Flow
1. Code validation endpoint: `POST /api/redeem-codes/validate`
2. Code application endpoint: `POST /api/auth/redeem-code/apply`
3. User gets plan upgrade and credits immediately

## API Endpoints

### Validate Redeem Code
```http
POST /api/redeem-codes/validate
Content-Type: application/json

{
  "redeemCode": "STU-335052-MV9TOI"
}
```

### Apply Redeem Code (requires authentication)
```http
POST /api/auth/redeem-code/apply
Content-Type: application/json
Cookie: app_session=<session_token>

{
  "redeemCode": "STU-335052-MV9TOI"
}
```

## Testing the Flow

1. Start both frontend and backend servers
2. Go to signup page
3. Complete email verification
4. Set a username
5. On redeem code screen, try entering:
   - `STU-335052-MV9TOI` (Student plan)
   - `BUS-335483-PRLKHW` (Business plan)
   - Or skip to continue with free plan

## Database Structure

### redeemCodes Collection
```javascript
{
  code: "STU-335052-MV9TOI",
  type: "STUDENT",
  planCode: "PLAN_A",
  status: "ACTIVE",
  maxUses: 10,
  currentUses: 0,
  validUntil: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  createdBy: null,
  usedBy: []
}
```

### redeemCodeUsages Collection
```javascript
{
  redeemCode: "STU-335052-MV9TOI",
  uid: "user_id",
  username: "username",
  email: "user@email.com",
  planCodeAssigned: "PLAN_A",
  creditsGranted: 12360,
  usedAt: timestamp
}
```

## Future Enhancements

1. **Admin Dashboard**: Create UI for generating and managing codes
2. **Role-Based Access**: Add admin roles for code generation
3. **Expiration Dates**: Add time-based code expiration
4. **Usage Analytics**: Track code usage patterns
5. **Bulk Generation**: Generate codes with custom parameters

## Troubleshooting

### Code Not Working
- Check if code exists in Firestore `redeemCodes` collection
- Verify code status is "ACTIVE"
- Check if code has remaining uses
- Ensure user hasn't already used the code

### Validation Errors
- Make sure code is uppercase
- Check code format (STU-XXXXXX-XXXXXX or BUS-XXXXXX-XXXXXX)
- Verify Firebase connection

### Plan Assignment Issues
- Check if user exists in Firestore
- Verify credits service is working
- Check plan codes are correct (PLAN_A, PLAN_B)
