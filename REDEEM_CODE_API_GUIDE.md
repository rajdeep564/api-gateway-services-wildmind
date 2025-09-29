# Redeem Code API Guide

## Overview
This guide explains how to use the Redeem Code API endpoints to create and manage redeem codes for the WildMind AI platform.

## Admin Key
**Admin Key**: Set via environment variable `REDEEM_CODE_ADMIN_KEY` or defaults to `WILDMIND_ADMIN_2024`

Add to your `.env` file:
```
REDEEM_CODE_ADMIN_KEY=your_secret_admin_key_here
```

## Base URL
```
http://localhost:5000/api
```

## Endpoints

### 1. Create Redeem Codes
**POST** `/redeem-codes/create`

Creates new redeem codes with flexible parameters.

#### Request Body
```json
{
  "type": "STUDENT" | "BUSINESS",
  "count": 1-1000,
  "maxUsesPerCode": 1-100,
  "expiresIn": 48, // Optional, hours from now (defaults to 48 hours)
  "adminKey": "WILDMIND_ADMIN_2024"
}
```

#### Parameters
- **type** (required): `STUDENT` or `BUSINESS`
- **count** (required): Number of codes to generate (1-1000)
- **maxUsesPerCode** (optional): Max uses per code (1-100, defaults to 1)
- **expiresIn** (optional): Hours from creation time (1-8760, defaults to 48 hours)
- **adminKey** (required): Admin authentication key

#### Response
```json
{
  "responseStatus": "success",
  "message": "5 Student Plan (PLAN_A) codes created successfully",
  "data": {
    "codes": ["STU-123456-ABC123", "STU-789012-DEF456", ...],
    "type": "STUDENT",
    "planName": "Student Plan (PLAN_A)",
    "count": 5,
    "maxUsesPerCode": 1,
    "expiresInHours": 48,
    "expiresAt": "2024-09-30T09:16:16.464Z",
    "expiresAtReadable": "9/30/2024, 9:16:16 AM",
    "creditsPerCode": 12360
  }
}
```

### 2. Validate Redeem Code
**POST** `/redeem-codes/validate`

Validates a redeem code without applying it.

#### Request Body
```json
{
  "redeemCode": "STU-123456-ABC123"
}
```

#### Response
```json
{
  "responseStatus": "success",
  "message": "Redeem code validation result",
  "data": {
    "valid": true,
    "planCode": "PLAN_A",
    "creditsToGrant": 12360,
    "remainingTime": "47 hours 30 minutes",
    "expiresAt": "2024-09-30T09:16:16.464Z",
    "planName": "Student Plan"
  }
}
```

#### Validation Response Fields
- **valid**: Boolean indicating if the code is valid
- **planCode**: The plan code (PLAN_A or PLAN_B)
- **creditsToGrant**: Number of credits the user will receive
- **remainingTime**: Human-readable time remaining (e.g., "47 hours 30 minutes", "2 days 5 hours")
- **expiresAt**: ISO timestamp of when the code expires
- **planName**: Human-readable plan name
- **error**: Error message if validation fails

### 3. Apply Redeem Code (Requires Authentication)
**POST** `/auth/redeem-code/apply`

Applies a redeem code to upgrade user's plan.

#### Request Body
```json
{
  "redeemCode": "STU-123456-ABC123"
}
```

#### Headers
```
Cookie: app_session=<session_token>
```


## Common Expiry Hours Examples
- **24 hours**: `"expiresIn": 24`
- **48 hours** (default): `"expiresIn": 48` or omit the field
- **72 hours** (3 days): `"expiresIn": 72`
- **168 hours** (1 week): `"expiresIn": 168`
- **720 hours** (1 month): `"expiresIn": 720`
- **8760 hours** (1 year): `"expiresIn": 8760`

## Examples

### Example 1: Create 10 Student Codes (Default 48-hour expiry)
```bash
curl -X POST http://localhost:5000/api/redeem-codes/create \
  -H "Content-Type: application/json" \
  -d '{
    "type": "STUDENT",
    "count": 10,
    "maxUsesPerCode": 1,
    "adminKey": "WILDMIND_ADMIN_2024"
  }'
```

### Example 2: Create 5 Business Codes with 72 Hour Expiry
```bash
curl -X POST http://localhost:5000/api/redeem-codes/create \
  -H "Content-Type: application/json" \
  -d '{
    "type": "BUSINESS",
    "count": 5,
    "maxUsesPerCode": 1,
    "expiresIn": 72,
    "adminKey": "WILDMIND_ADMIN_2024"
  }'
```

### Example 3: Create Reusable Test Codes with 168 Hour Expiry (1 Week)
```bash
curl -X POST http://localhost:5000/api/redeem-codes/create \
  -H "Content-Type: application/json" \
  -d '{
    "type": "STUDENT",
    "count": 3,
    "maxUsesPerCode": 10,
    "expiresIn": 168,
    "adminKey": "WILDMIND_ADMIN_2024"
  }'
```

### Example 4: Validate a Code
```bash
curl -X POST http://localhost:5000/api/redeem-codes/validate \
  -H "Content-Type: application/json" \
  -d '{
    "redeemCode": "STU-123456-ABC123"
  }'
```

## Plan Details

### Student Plan (PLAN_A)
- **Credits**: 12,360
- **Code Prefix**: STU-
- **Use Case**: Individual students

### Business Plan (PLAN_B)
- **Credits**: 24,720
- **Code Prefix**: BUS-
- **Use Case**: Business users

### Free Plan (Default)
- **Credits**: 4,120
- **Code Prefix**: N/A
- **Use Case**: Users without redeem codes

## Error Handling

### Common Error Responses

#### Invalid Admin Key
```json
{
  "responseStatus": "error",
  "message": "Unauthorized. Invalid admin key.",
  "data": null
}
```

#### Invalid Type
```json
{
  "responseStatus": "error",
  "message": "Invalid type. Must be STUDENT or BUSINESS",
  "data": null
}
```

#### Invalid Count
```json
{
  "responseStatus": "error",
  "message": "Count must be between 1 and 1000",
  "data": null
}
```

#### Invalid Expiry Hours
```json
{
  "responseStatus": "error",
  "message": "expiresIn must be an integer between 1 and 8760 hours (1 year)",
  "data": null
}
```

#### Expired Code
```json
{
  "responseStatus": "success",
  "message": "Redeem code validation result",
  "data": {
    "valid": false,
    "error": "Redeem code expired 2 hours ago (9/29/2024, 3:16:16 PM)"
  }
}
```

#### Code with No Uses Left
```json
{
  "responseStatus": "success",
  "message": "Redeem code validation result",
  "data": {
    "valid": false,
    "error": "Redeem code has reached maximum uses"
  }
}
```

## Postman Collection

Import the collection file: `postman/redeem_codes_collection.json`

The collection includes:
- Create Student Codes
- Create Business Codes
- Create Codes with Custom Expiry
- Validate Redeem Code

## Best Practices

1. **Batch Creation**: Create codes in batches of 10-50 for better performance
2. **Expiry Management**: Set appropriate expiry dates based on your campaign needs
3. **Usage Limits**: Set maxUsesPerCode based on your distribution strategy
4. **Testing**: Use the create endpoint with small batches for development
5. **Validation**: Always validate codes before applying them in production

## Security Notes

- Admin key is currently hardcoded for simplicity
- In production, implement proper role-based authentication
- Monitor code usage and expiration
- Consider rate limiting for code creation endpoints
