## BFL Credits Testing Guide (Postman)

This guide shows how to test the credit system using Postman (or curl).

### Prerequisites
- Server running: `npm run dev` (default `http://localhost:5000`)
- Environment variables set: `BFL_API_KEY`, Firebase Admin credentials
- A Firebase Web API Key to get an ID token for auth

### 1) Get an ID token (Login)
Make a POST to Firebase Identity Toolkit:

POST `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<WEB_API_KEY>`

Body (raw JSON):
```
{
  "email": "<email>",
  "password": "<password>",
  "returnSecureToken": true
}
```

Expected 200 response contains `idToken` and `localId` (your `uid`).

In Postman, set a collection/environment variable `ID_TOKEN` with this value and use it as a Cookie in subsequent requests:

Header:
```
Cookie: app_session={{ID_TOKEN}}
```

### 2) Health check (GET)
GET `http://localhost:5000/health`

Expected 200 response:
```
{
  "responseStatus": "success",
  "message": "OK",
  "data": { "uptime": <number> }
}
```

### 3) List my generations (GET)
GET `http://localhost:5000/api/generations` with Cookie `app_session={{ID_TOKEN}}`

Optional query params:
- `limit` (1..50)
- `cursor`
- `status` in `generating|completed|failed`
- `generationType`

Expected 200 response:
```
{
  "responseStatus": "success",
  "message": "...",
  "data": { "items": [ ... ], "nextCursor": "..." }
}
```

### 4) BFL Generate (POST)
POST `http://localhost:5000/api/bfl/generate`

Headers:
```
Content-Type: application/json
Cookie: app_session={{ID_TOKEN}}
```

Body:
```
{
  "prompt": "cat in watercolor",
  "model": "flux-pro-1.1",
  "n": 1,
  "frameSize": "1:1",
  "output_format": "jpeg"
}
```

Expected outcomes:
- If insufficient credits → 402:
```
{
  "responseStatus": "error",
  "message": "Payment Required",
  "data": {
    "requiredCredits": <number>,
    "currentBalance": <number>,
    "suggestion": "Buy plan or reduce n/size"
  }
}
```
- On success → 200:
```
{
  "responseStatus": "success",
  "message": "Images generated",
  "data": {
    "historyId": "...",
    "images": [ { "id": "...", "url": "...", "storagePath": "...", "originalUrl": "..." } ],
    "status": "completed",
    ...
  }
}
```

Ledger and balance effects (Firestore):
- `users/{uid}/ledgers/{historyId}` exists with `{ type:'DEBIT', status:'CONFIRMED', amount:-<cost> }`
- `users/{uid}.creditBalance` decreased by `<cost>`

### 5) BFL Fill (POST)
POST `http://localhost:5000/api/bfl/fill`

Body:
```
{
  "prompt": "repair",
  "image": "https://.../your.jpg",
  "output_format": "jpeg"
}
```

Expected 200 success with `historyId` and images, debit created; or 402 like above on insufficient credits.

### 6) BFL Expand (POST)
POST `http://localhost:5000/api/bfl/expand`

Body:
```
{
  "prompt": "wider",
  "image": "https://.../your.jpg",
  "right": 200,
  "output_format": "jpeg"
}
```

Expected 200 success and debit; or 402 insufficient credits.

### 7) BFL Canny (POST)
POST `http://localhost:5000/api/bfl/canny`

Body:
```
{
  "prompt": "line art",
  "control_image": "https://.../edge.png",
  "output_format": "jpeg"
}
```

Expected 200 success and debit; or 402 insufficient credits.

### 8) BFL Depth (POST)
POST `http://localhost:5000/api/bfl/depth`

Body:
```
{
  "prompt": "depth render",
  "control_image": "https://.../depth.png",
  "output_format": "jpeg"
}
```

Expected 200 success and debit; or 402 insufficient credits.

### 9) Verify ledgers and balance (GET via Console)
- In Firestore, check:
  - `plans/FREE` exists
  - `users/{uid}` has `creditBalance` and `planCode`
  - `users/{uid}/ledgers/{historyId}` created on success with `DEBIT`

### Notes
- Pricing version is included internally; future Postman collections can log it in responses as needed.
- For stress-testing insufficient credits, use large dimensions (e.g., 4096×4096) or `png` to raise cost.
- For idempotency against client retries, we can add `X-Idempotency-Key` support later.


