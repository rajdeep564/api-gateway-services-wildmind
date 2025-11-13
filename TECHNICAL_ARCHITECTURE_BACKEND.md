# API Gateway Services - Technical Architecture & Dataflow Documentation

## Table of Contents
1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Technology Stack](#technology-stack)
4. [Layered Architecture](#layered-architecture)
5. [Data Flow Patterns](#data-flow-patterns)
6. [Authentication & Authorization](#authentication--authorization)
7. [Credit System](#credit-system)
8. [External Service Integrations](#external-service-integrations)
9. [Storage & Caching](#storage--caching)
10. [Security & Middleware](#security--middleware)
11. [API Endpoints](#api-endpoints)
12. [Error Handling](#error-handling)
13. [Deployment & Infrastructure](#deployment--infrastructure)

---

## Overview

The API Gateway Services is a Node.js/Express-based microservice that acts as a unified API layer for WildMind AI's generation services. It provides authentication, credit management, request routing, and integration with multiple AI generation providers (Replicate, BFL, FAL, Runway, MiniMax, OpenAI).

### Key Responsibilities
- **Authentication & Session Management**: Firebase Auth integration with Redis caching
- **Credit Management**: Transactional credit system with ledger tracking
- **Request Routing**: Route requests to appropriate AI service providers
- **Generation History**: Track and manage user generation history
- **Public Feed**: Manage public generation feed with filtering
- **Redeem Codes**: Handle promotional code redemption
- **Storage**: S3-compatible storage via Zata for generated assets

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Applications                        │
│  (Web Frontend, Canvas Studio, Mobile Apps)                      │
└────────────────────────────┬──────────────────────────────────────┘
                             │ HTTPS
                             │ CORS + Cookies
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API Gateway Services                          │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Express.js Application (Port 5001)                      │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │   │
│  │  │  Middleware  │→ │  Controllers │→ │   Services   │  │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  │   │
│  │         │                  │                  │           │   │
│  │         ▼                  ▼                  ▼           │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │   │
│  │  │  Validators  │  │  Repositories│  │   External    │  │   │
│  │  │  Auth        │  │  (Firestore) │  │   Services    │  │   │
│  │  │  Credit Cost │  │              │  │               │  │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────────┬──────────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  Firebase    │    │    Redis     │    │    Zata      │
│  (Auth + DB) │    │   (Cache)    │    │   (Storage)  │
└──────────────┘    └──────────────┘    └──────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│                    External AI Services                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ Replicate│  │   BFL   │  │   FAL    │  │  Runway  │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
│  ┌──────────┐  ┌──────────┐                                    │
│  │ MiniMax  │  │  OpenAI  │                                    │
│  └──────────┘  └──────────┘                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

### Core Technologies
- **Runtime**: Node.js (v20+)
- **Framework**: Express.js 4.18.2
- **Language**: TypeScript 5.3.3
- **Database**: Firebase Firestore (via Firebase Admin SDK)
- **Cache**: Redis 4.6.13 (optional, for session caching)
- **Storage**: Zata (S3-compatible object storage)

### Key Dependencies
- **Authentication**: Firebase Admin SDK 13.5.0
- **HTTP Client**: Axios 1.12.2
- **Validation**: Zod 3.23.8, express-validator 7.0.1
- **Logging**: Pino 9.10.0, pino-http 10.5.0
- **Security**: Helmet 8.1.0, CORS 2.8.5, HPP 0.2.3
- **AI Services**: 
  - Replicate SDK 1.2.0
  - FAL Client 1.6.2
  - Runway SDK 2.10.0
  - OpenAI SDK 6.1.0
- **Image Processing**: Sharp 0.34.4
- **Compression**: compression 1.8.1
- **Rate Limiting**: express-rate-limit 8.1.0

---

## Layered Architecture

The application follows a **layered architecture pattern** with clear separation of concerns:

### 1. **Routes Layer** (`src/routes/`)
- **Purpose**: Define API endpoints and HTTP method mappings
- **Responsibilities**:
  - Route registration
  - Middleware chaining (auth, validation, credit cost)
  - Request/response handling delegation
- **Key Files**:
  - `index.ts`: Main router aggregator
  - `authRoutes.ts`: Authentication endpoints
  - `replicate.ts`, `bfl.ts`, `fal.ts`, etc.: Provider-specific routes
  - `credits.ts`: Credit management routes
  - `generations.ts`: Generation history routes
  - `publicGenerations.ts`: Public feed routes
  - `redeemCodes.ts`: Redeem code routes

### 2. **Middleware Layer** (`src/middlewares/`)
- **Purpose**: Request processing, validation, and transformation
- **Categories**:

#### Authentication Middleware
- `authMiddleware.ts`: `requireAuth` - Verifies Firebase session cookies/ID tokens
  - Checks Redis cache first for performance
  - Falls back to Firebase Admin SDK verification
  - Caches verified sessions in Redis

#### Validation Middleware
- `validators/`: Provider-specific request validation
  - `validateAuth.ts`: Auth request validation
  - `validateBflGenerate.ts`, `validateFalGenerate.ts`, etc.
  - Uses Zod schemas for type-safe validation

#### Credit Cost Middleware
- `creditCost.ts`: Pre-authorizes credits before generation
- `creditCostFactory.ts`: Factory for creating provider-specific credit cost middleware
- Calculates cost based on model, parameters, and pricing rules
- Returns 402 Payment Required if insufficient credits

#### Security Middleware (`security.ts`)
- `requestId`: Adds unique request ID for tracing
- `securityHeaders`: Sets security headers (Helmet)
- `httpParamPollution`: Prevents HTTP parameter pollution
- `gzipCompression`: Response compression
- `originCheck`: Production origin validation
- `httpLogger`: Request/response logging (Pino)

### 3. **Controllers Layer** (`src/controllers/`)
- **Purpose**: Handle HTTP request/response, orchestrate service calls
- **Responsibilities**:
  - Extract request data
  - Call appropriate services
  - Format responses
  - Handle errors
- **Key Controllers**:
  - `authController.ts`: Authentication operations
  - `creditsController.ts`: Credit balance queries
  - `replicateController.ts`: Replicate API operations
  - `bflController.ts`: BFL API operations
  - `falController.ts`: FAL API operations
  - `minimaxController.ts`: MiniMax API operations
  - `runwayController.ts`: Runway API operations
  - `generationHistoryController.ts`: Generation history management
  - `publicGenerationsController.ts`: Public feed management
  - `redeemCodeController.ts`: Redeem code operations

### 4. **Services Layer** (`src/services/`)
- **Purpose**: Business logic and external API integration
- **Responsibilities**:
  - Business rule enforcement
  - External API calls
  - Data transformation
  - Orchestration of multiple operations
- **Key Services**:
  - `authService.ts`: User authentication and management
  - `creditsService.ts`: Credit operations (init, switch plan, etc.)
  - `replicateService.ts`: Replicate API integration
  - `bflService.ts`: BFL API integration
  - `falService.ts`: FAL API integration
  - `minimaxService.ts`: MiniMax API integration
  - `runwayService.ts`: Runway API integration
  - `generationHistoryService.ts`: Generation history operations
  - `generationFilterService.ts`: Public feed filtering logic
  - `redeemCodeService.ts`: Redeem code validation and application

### 5. **Repository Layer** (`src/repository/`)
- **Purpose**: Data access abstraction
- **Responsibilities**:
  - Firestore operations
  - Data mapping
  - Transaction management
- **Key Repositories**:
  - `authRepository.ts`: User data access
  - `creditsRepository.ts`: Credit ledger operations
  - `replicateRepository.ts`: Replicate job tracking
  - `bflRepository.ts`: BFL job tracking
  - `falRepository.ts`: FAL job tracking
  - `generationHistoryRepository.ts`: Generation history storage
  - `generationsMirrorRepository.ts`: Public feed mirror storage
  - `publicGenerationsRepository.ts`: Public feed queries
  - `redeemCodeRepository.ts`: Redeem code storage

### 6. **Utils Layer** (`src/utils/`)
- **Purpose**: Shared utilities and helpers
- **Key Utilities**:
  - `errorHandler.ts`: Centralized error handling
  - `formatApiResponse.ts`: Standardized API response format
  - `logger.ts`: Pino logger configuration
  - `sessionStore.ts`: Redis session caching
  - `deviceInfo.ts`: Device information extraction
  - `mailer.ts`: Email sending (Nodemailer/Resend)
  - `pricing/`: Provider-specific pricing calculators
  - `storage/zataClient.ts`: Zata S3 client configuration
  - `storage/zataUpload.ts`: File upload utilities

### 7. **Config Layer** (`src/config/`)
- **Purpose**: Configuration and initialization
- **Key Files**:
  - `env.ts`: Environment variable management
  - `firebaseAdmin.ts`: Firebase Admin SDK initialization
  - `firebaseConfig.ts`: Firebase client config
  - `redisClient.ts`: Redis client initialization
  - `credentials/`: Service account credentials

---

## Data Flow Patterns

### 1. **Authentication Flow**

```
Client Request
    │
    ▼
[Express App]
    │
    ▼
[CORS Middleware] → Validates origin, sets credentials
    │
    ▼
[Request ID Middleware] → Adds unique request ID
    │
    ▼
[Security Headers] → Sets security headers
    │
    ▼
[Auth Middleware (requireAuth)]
    │
    ├─→ [Check Cookie/Header] → Extract token
    │
    ├─→ [Redis Cache Check] → Fast path if cached
    │   └─→ [Cache Hit] → Set req.uid, continue
    │
    └─→ [Cache Miss] → Verify with Firebase Admin
        │
        ├─→ [Verify Session Cookie] → Primary method
        │   └─→ [Success] → Cache in Redis, set req.uid
        │
        └─→ [Fallback: Verify ID Token] → If session cookie fails
            └─→ [Success] → Cache in Redis, set req.uid
    │
    ▼
[Controller] → Process request with authenticated user
```

### 2. **Generation Request Flow (with Credit Deduction)**

```
Client Request (POST /api/replicate/generate)
    │
    ▼
[Auth Middleware] → Verify user authentication
    │
    ▼
[Validation Middleware] → Validate request body (Zod)
    │
    ▼
[Credit Cost Middleware]
    │
    ├─→ [Calculate Cost] → Based on model, parameters, pricing rules
    │
    ├─→ [Check Balance] → Query user credits from Firestore
    │
    ├─→ [Insufficient Credits] → Return 402 Payment Required
    │
    └─→ [Sufficient Credits] → Pre-authorize (store in req.context)
    │
    ▼
[Controller] → Call service
    │
    ▼
[Service] → Call external API (Replicate)
    │
    ├─→ [Success] → Set res.locals.success = true
    │
    └─→ [Failure] → Throw error
    │
    ▼
[Post-Controller Handler] → Check res.locals.success
    │
    ├─→ [Success] → Debit credits from ledger (idempotent)
    │   │
    │   └─→ [Firestore Transaction]
    │       ├─→ Check ledger entry (prevent duplicate)
    │       ├─→ Create ledger entry (DEBIT)
    │       └─→ Update user creditBalance atomically
    │
    └─→ [Failure] → No debit (credits remain)
    │
    ▼
[Response] → Return result to client
```

### 3. **Queue-Based Generation Flow (Async)**

```
Client Request (POST /api/replicate/wan-2-5-t2v/submit)
    │
    ▼
[Auth Middleware] → Verify authentication
    │
    ▼
[Validation Middleware] → Validate request
    │
    ▼
[Credit Cost Middleware] → Pre-authorize credits
    │
    ▼
[Controller] → Submit job to Replicate
    │
    ├─→ [Service] → Call Replicate API
    │   │
    │   └─→ [Repository] → Store job status in Firestore
    │       └─→ Status: "submitted", requestId stored
    │
    └─→ [Response] → Return requestId to client
    │
    ▼
Client Polls (GET /api/replicate/queue/status?requestId=...)
    │
    ▼
[Controller] → Query job status
    │
    ├─→ [Repository] → Check Firestore for job status
    │
    └─→ [Response] → Return current status
    │
    ▼
Client Polls (GET /api/replicate/queue/result?requestId=...)
    │
    ▼
[Controller] → Get final result
    │
    ├─→ [Service] → Poll Replicate API
    │   │
    │   ├─→ [Still Processing] → Return status
    │   │
    │   └─→ [Completed] → 
    │       │
    │       ├─→ [Repository] → Update job status in Firestore
    │       │
    │       ├─→ [Debit Credits] → Deduct from ledger
    │       │
    │       ├─→ [Upload to Zata] → Store generated asset
    │       │
    │       └─→ [Generation History] → Record in history
    │
    └─→ [Response] → Return result URL
```

### 4. **Session Creation Flow**

```
Client Request (POST /api/auth/session)
    │
    ▼
[Validation Middleware] → Validate idToken
    │
    ▼
[Controller] → createSession
    │
    ├─→ [Service] → Verify ID token with Firebase
    │   │
    │   ├─→ [Get/Create User] → Query/create user in Firestore
    │   │
    │   └─→ [Return User Data]
    │
    ├─→ [Create Session Cookie] → Firebase Admin createSessionCookie
    │   │
    │   └─→ [Set Cookie] → app_session cookie with domain=.wildmindai.com
    │
    ├─→ [Cache Session] → Store in Redis (hash token, cache uid)
    │
    ├─→ [Initialize Credits] → Ensure user has FREE plan credits
    │   │
    │   └─→ [Repository] → Create/update user credits doc
    │
    └─→ [Response] → Return user data
```

---

## Authentication & Authorization

### Authentication Methods

1. **Session Cookie (Primary)**
   - Cookie name: `app_session`
   - Domain: `.wildmindai.com` (production) for cross-subdomain sharing
   - SameSite: `None` (production), `Lax` (development)
   - Secure: `true` (production)
   - Created via: `POST /api/auth/session`
   - Verified via: Firebase Admin `verifySessionCookie()`

2. **ID Token (Fallback)**
   - Header: `Authorization: Bearer <token>`
   - Verified via: Firebase Admin `verifyIdToken()`
   - Used when session cookie is not available

3. **Redis Caching**
   - Token hash (SHA-256) → Redis key
   - Key format: `sess:app:{hash}`
   - Value: `{ uid, exp, issuedAt, userAgent, ip }`
   - TTL: Derived from token expiration
   - Purpose: Reduce Firebase Admin API calls

### Authorization Flow

```typescript
requireAuth Middleware:
1. Extract token from cookie or Authorization header
2. Check Redis cache (fast path)
3. If cache miss:
   a. Try verifySessionCookie()
   b. Fallback to verifyIdToken()
4. Cache result in Redis
5. Set req.uid for downstream handlers
```

### Session Management

- **Creation**: `POST /api/auth/session` with Firebase ID token
- **Validation**: Automatic via `requireAuth` middleware
- **Invalidation**: `POST /api/auth/logout` (clears cookie, deletes Redis cache)
- **Cross-Subdomain**: Enabled via `.wildmindai.com` domain cookie

---

## Credit System

### Architecture

The credit system uses a **ledger-based accounting model** with atomic transactions:

```
User Document (users/{uid})
├── creditBalance: number (current balance)
├── planCode: string (FREE, PLAN_A, PLAN_B, PLAN_C, PLAN_D)
└── ledgers/ (subcollection)
    └── {requestId}
        ├── type: 'DEBIT' | 'GRANT' | 'REFUND' | 'HOLD'
        ├── amount: number (negative for DEBIT, positive for GRANT)
        ├── reason: string (e.g., 'replicate.generate')
        ├── status: 'PENDING' | 'CONFIRMED' | 'REVERSED'
        ├── meta: object (pricing version, model, etc.)
        └── createdAt: timestamp
```

### Credit Operations

1. **Initialization**
   - Triggered on first authentication
   - Creates user document with FREE plan (4120 credits)
   - Ensures plan document exists

2. **Debit (Spending)**
   - **Idempotent**: Uses `requestId` to prevent duplicate charges
   - **Atomic**: Firestore transaction ensures consistency
   - **Flow**:
     ```
     Transaction:
     1. Check if ledger entry exists (by requestId)
     2. If exists and CONFIRMED → SKIP
     3. If not exists:
        a. Create ledger entry (DEBIT, CONFIRMED)
        b. Decrement creditBalance atomically
     ```

3. **Grant (Refund/Promotion)**
   - Similar to debit but with positive amount
   - Used for redeem codes, refunds, promotions

4. **Plan Switching**
   - Updates `planCode` in user document
   - Does not modify `creditBalance` (credits persist)

### Pricing System

- **Location**: `src/utils/pricing/`
- **Provider-specific calculators**:
  - `replicatePricing.ts`: Replicate models
  - `bflPricing.ts`: BFL models
  - `falPricing.ts`: FAL models
  - `klingPricing.ts`: Kling video models
  - `wanPricing.ts`: WAN video models
  - `seedancePricing.ts`: Seedance video models
  - `pixversePricing.ts`: PixVerse video models
  - `minimaxPricing.ts`: MiniMax models
  - `runwayPricing.ts`: Runway models

- **Pricing Version**: Stored in ledger `meta.pricingVersion` for audit trail

---

## External Service Integrations

### 1. **Replicate**
- **Purpose**: Image generation, video generation, upscaling, background removal
- **Models**:
  - Image: Seedream v4, Ideogram, Magic Refiner
  - Video: WAN 2.5 (T2V, I2V), Kling (T2V, I2V), Seedance (T2V, I2V), PixVerse v5 (T2V, I2V)
  - Utilities: Upscale, Remove Background
- **Flow**: Queue-based (submit → poll status → get result)
- **Repository**: `replicateRepository.ts` (tracks job status in Firestore)

### 2. **BFL (Black Forest Labs)**
- **Purpose**: Flux image generation
- **Models**: flux-kontext-max, flux-kontext-pro
- **Flow**: Polling-based (submit → poll until complete)
- **Repository**: `bflRepository.ts`

### 3. **FAL (Fal.ai)**
- **Purpose**: Fast image generation
- **Flow**: Direct API calls
- **Repository**: `falRepository.ts`

### 4. **Runway**
- **Purpose**: Video generation
- **Flow**: SDK-based integration
- **Repository**: `runwayRepository.ts`

### 5. **MiniMax**
- **Purpose**: Image and video generation, music generation
- **Flow**: Direct API calls
- **Repository**: `minimaxRepository.ts`

### 6. **OpenAI**
- **Purpose**: DALL-E image generation
- **Flow**: Direct API calls
- **Service**: `services/openai.ts`

---

## Storage & Caching

### 1. **Firebase Firestore**
- **Primary Database**: All persistent data
- **Collections**:
  - `users/{uid}`: User profiles, credits
  - `users/{uid}/ledgers/{requestId}`: Credit transactions
  - `generations/{uid}/history/{historyId}`: Generation history
  - `generations_public/{historyId}`: Public feed mirror
  - `plans/{planCode}`: Plan definitions
  - `redeem_codes/{code}`: Redeem code definitions
  - `replicate_jobs/{uid}/{jobId}`: Replicate job tracking
  - `bfl_jobs/{uid}/{jobId}`: BFL job tracking
  - `fal_jobs/{uid}/{jobId}`: FAL job tracking

### 2. **Redis (Optional)**
- **Purpose**: Session caching for performance
- **Configuration**: `REDIS_URL` environment variable
- **Usage**:
  - Session token → UID mapping
  - TTL based on token expiration
  - Reduces Firebase Admin API calls
- **Key Format**: `sess:app:{sha256(token)}`
- **Utilities**: `utils/sessionStore.ts`

### 3. **Zata Storage (S3-Compatible)**
- **Purpose**: Store generated images/videos
- **Client**: AWS SDK S3 Client
- **Configuration**: `ZATA_ENDPOINT`, `ZATA_BUCKET`, `ZATA_ACCESS_KEY_ID`, `ZATA_SECRET_ACCESS_KEY`
- **Utilities**: `utils/storage/zataClient.ts`, `utils/storage/zataUpload.ts`
- **Public URLs**: Generated via `makeZataPublicUrl(key)`

---

## Security & Middleware

### Security Features

1. **CORS**
   - Production: `wildmindai.com`, `www.wildmindai.com`, `studio.wildmindai.com`
   - Development: `localhost:3000`, `localhost:3001`
   - Credentials: `true` (cookies enabled)

2. **Helmet**
   - Security headers (XSS protection, content type sniffing, etc.)

3. **HTTP Parameter Pollution (HPP)**
   - Prevents duplicate parameter attacks

4. **Rate Limiting**
   - `express-rate-limit` (configured per route if needed)

5. **Request Validation**
   - Zod schemas for type-safe validation
   - Express-validator for additional checks

6. **Origin Check** (Production)
   - Validates request origin matches allowed list

### Middleware Order

```
1. requestId (add unique ID)
2. securityHeaders (Helmet)
3. CORS
4. bodyParser (JSON, URL-encoded)
5. cookieParser
6. httpParamPollution
7. gzipCompression
8. httpLogger
9. originCheck (production only)
10. Routes (with route-specific middleware)
11. errorHandler (global)
```

---

## API Endpoints

### Authentication (`/api/auth`)
- `POST /api/auth/session` - Create session from ID token
- `POST /api/auth/login` - Email/password login
- `POST /api/auth/google` - Google OAuth sign-in
- `POST /api/auth/email/start` - Start email OTP flow
- `POST /api/auth/email/verify` - Verify email OTP
- `GET /api/auth/me` - Get current user (requires auth)
- `PATCH /api/auth/me` - Update user profile (requires auth)
- `POST /api/auth/logout` - Logout (clear session)
- `GET /api/auth/username/check` - Check username availability
- `POST /api/auth/redeem-code/apply` - Apply redeem code (requires auth)

### Credits (`/api/credits`)
- `GET /api/credits/me` - Get credit balance and recent ledgers (requires auth)

### Replicate (`/api/replicate`)
- `POST /api/replicate/generate` - Generate image (Seedream/Ideogram)
- `POST /api/replicate/upscale` - Upscale image
- `POST /api/replicate/remove-bg` - Remove background
- `POST /api/replicate/wan-2-5-t2v/submit` - Submit WAN T2V job
- `POST /api/replicate/wan-2-5-i2v/submit` - Submit WAN I2V job
- `POST /api/replicate/kling-t2v/submit` - Submit Kling T2V job
- `POST /api/replicate/kling-i2v/submit` - Submit Kling I2V job
- `POST /api/replicate/seedance-t2v/submit` - Submit Seedance T2V job
- `POST /api/replicate/seedance-i2v/submit` - Submit Seedance I2V job
- `POST /api/replicate/pixverse-v5-t2v/submit` - Submit PixVerse T2V job
- `POST /api/replicate/pixverse-v5-i2v/submit` - Submit PixVerse I2V job
- `GET /api/replicate/queue/status` - Get job status
- `GET /api/replicate/queue/result` - Get job result

### BFL (`/api/bfl`)
- `POST /api/bfl/generate` - Generate Flux image

### FAL (`/api/fal`)
- `POST /api/fal/generate` - Generate image via FAL

### Runway (`/api/runway`)
- `POST /api/runway/generate` - Generate video

### MiniMax (`/api/minimax`)
- `POST /api/minimax/generate` - Generate image
- `POST /api/minimax/video` - Generate video
- `POST /api/minimax/music` - Generate music

### Generations (`/api/generations`)
- `POST /api/generations` - Start generation (create history entry)
- `PATCH /api/generations/:historyId/complete` - Mark generation complete
- `PATCH /api/generations/:historyId/fail` - Mark generation failed
- `GET /api/generations` - List user's generation history

### Public Feed (`/api/feed`)
- `GET /api/feed` - Get public generations feed (filtered, paginated)

### Redeem Codes (`/api/redeem-codes`)
- `POST /api/redeem-codes/apply` - Apply redeem code (via auth routes)

### Health Checks
- `GET /health` - Basic health check
- `GET /health/auth` - Auth configuration health
- `GET /health/redis` - Redis connection health

---

## Error Handling

### Error Structure

```typescript
{
  responseStatus: 'error' | 'success',
  message: string,
  data: any,
  error?: {
    code?: string,
    details?: any
  }
}
```

### Error Flow

1. **Controller/Service throws error**
2. **Caught by errorHandler middleware**
3. **ErrorHandler**:
   - Logs error (Pino)
   - Formats response
   - Sets appropriate HTTP status
   - Returns standardized error response

### Error Types

- `ApiError`: Custom application errors (400, 401, 403, 404, 500)
- **Validation Errors**: 400 (from Zod/express-validator)
- **Authentication Errors**: 401 (from requireAuth)
- **Credit Errors**: 402 Payment Required
- **Not Found**: 404
- **Server Errors**: 500

---

## Deployment & Infrastructure

### Environment Variables

**Required**:
- `NODE_ENV`: `production` | `development`
- `PORT`: Server port (default: 5001)
- `FIREBASE_SERVICE_ACCOUNT_JSON` or `FIREBASE_SERVICE_ACCOUNT_B64`: Firebase credentials
- `FIREBASE_PROJECT_ID`: Firebase project ID
- `ZATA_ENDPOINT`: Zata storage endpoint
- `ZATA_BUCKET`: Zata bucket name
- `ZATA_ACCESS_KEY_ID`: Zata access key
- `ZATA_SECRET_ACCESS_KEY`: Zata secret key

**Optional**:
- `REDIS_URL`: Redis connection string (for session caching)
- `REDIS_PREFIX`: Redis key prefix (default: `sess:app:`)
- `REDIS_DEBUG`: Enable Redis debug logging
- `AUTH_STRICT_REVOCATION`: Enable strict token revocation checks
- `FRONTEND_ORIGIN`: Allowed frontend origin
- `ALLOWED_ORIGINS`: Comma-separated list of allowed origins
- Provider API keys: `BFL_API_KEY`, `FAL_KEY`, `RUNWAY_API_KEY`, `MINIMAX_API_KEY`, `REPLICATE_API_KEY`, etc.

### Build & Run

```bash
# Development
npm run dev

# Production Build
npm run build
npm start
```

### Health Monitoring

- `/health`: Basic uptime check
- `/health/auth`: Auth configuration status
- `/health/redis`: Redis connection status

---

## Key Design Patterns

1. **Repository Pattern**: Data access abstraction
2. **Service Layer Pattern**: Business logic separation
3. **Middleware Chain**: Request processing pipeline
4. **Idempotency**: Credit debits use requestId to prevent duplicates
5. **Atomic Transactions**: Firestore transactions for credit operations
6. **Caching Strategy**: Redis for session tokens (fast path)
7. **Queue Pattern**: Async job processing for long-running operations
8. **Factory Pattern**: Credit cost middleware factory

---

## Performance Optimizations

1. **Redis Session Caching**: Reduces Firebase Admin API calls
2. **Gzip Compression**: Response compression
3. **Connection Pooling**: HTTP agent keep-alive (Zata client)
4. **Batch Operations**: Firestore batch writes where possible
5. **Lazy Loading**: Optional Redis initialization
6. **Request ID Tracking**: Distributed tracing support

---

## Future Considerations

1. **Rate Limiting**: Per-user rate limits
2. **Webhook Support**: For async job completion
3. **GraphQL**: Alternative API layer
4. **Microservices**: Split into smaller services
5. **Event Sourcing**: For credit ledger
6. **CDN Integration**: For generated asset delivery

---

## Conclusion

The API Gateway Services provides a robust, scalable architecture for managing AI generation requests with proper authentication, credit management, and integration with multiple AI providers. The layered architecture ensures maintainability, testability, and clear separation of concerns.

