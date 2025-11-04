# Redeem Code Setup Guide

## Environment Variables

Create a `.env` file in the `api-gateway-services` directory and add:

```bash
# Redeem Code Admin Key (Required)
REDEEM_CODE_ADMIN_KEY=your_secure_admin_key_here

# Example for development:
REDEEM_CODE_ADMIN_KEY=WILDMIND_ADMIN_2024
```

## Quick Setup

1. **Add Environment Variable**
   ```bash
   # In your .env file
   REDEEM_CODE_ADMIN_KEY=WILDMIND_ADMIN_2024
   ```

2. **Start the Server**
   ```bash
   npm start
   ```

3. **Test the API**
   ```bash
   # Create test codes
   node generateTestCodes.js
   
   # Test API endpoints
   node testAPI.js
   ```

## API Usage

### Create Redeem Codes
```bash
curl -X POST http://localhost:5001/api/redeem-codes/create \
  -H "Content-Type: application/json" \
  -d '{
    "type": "STUDENT",
    "count": 5,
    "expiresIn": 48,
    "adminKey": "WILDMIND_ADMIN_2024"
  }'
```

### Import Postman Collection
Import `postman/redeem_codes_collection.json` into Postman and set the `adminKey` variable to your environment variable value.

## Security Notes

- **Production**: Use a strong, random admin key
- **Development**: You can use the default `WILDMIND_ADMIN_2024`
- **Environment**: Never commit your actual admin key to version control

## Troubleshooting

### Firestore Errors
If you see "Cannot use undefined as a Firestore value", the issue has been fixed in the latest code.

### Admin Key Errors
Make sure your `REDEEM_CODE_ADMIN_KEY` environment variable matches the `adminKey` in your API requests.
