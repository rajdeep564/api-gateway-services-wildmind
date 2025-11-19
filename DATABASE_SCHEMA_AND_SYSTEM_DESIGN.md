# Database Schema & System Design Documentation

## Table of Contents
1. [Overview](#overview)
2. [Database Architecture](#database-architecture)
3. [Firestore Collections](#firestore-collections)
4. [Data Models](#data-models)
5. [Relationships & Data Flow](#relationships--data-flow)
6. [Indexing Strategy](#indexing-strategy)
7. [System Design Patterns](#system-design-patterns)
8. [Storage Architecture](#storage-architecture)
9. [Caching Strategy](#caching-strategy)
10. [Data Consistency](#data-consistency)

---

## Overview

The WildMind API Gateway uses **Firebase Firestore** as its primary database, **Zata (S3-compatible)** for file storage, and **Redis** for session caching. The system follows a **NoSQL document-based architecture** optimized for scalability and real-time operations.

### Database Technology Stack
- **Primary Database**: Firebase Firestore (NoSQL Document Database)
- **File Storage**: Zata (S3-compatible object storage)
- **Session Cache**: Redis
- **Authentication**: Firebase Auth (managed separately)

### Design Principles
1. **Document-Oriented**: Data stored as JSON documents in collections
2. **Subcollections**: User-specific data organized in subcollections for scalability
3. **Denormalization**: Public data mirrored for efficient queries
4. **Soft Deletes**: `isDeleted` flag instead of hard deletes
5. **Timestamps**: Server-side timestamps for consistency
6. **Batch Operations**: Atomic updates using Firestore batches

---

## Database Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Firebase Firestore                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Collections (Top-Level)                              │  │
│  │  ├── users/                                           │  │
│  │  ├── generations/                                     │  │
│  │  ├── redeemCodes/                                    │  │
│  │  ├── redeemCodeUsages/                               │  │
│  │  ├── replicateGenerations/                           │  │
│  │  └── plans/                                           │  │
│  │                                                         │  │
│  │  Subcollections (User-Specific)                      │  │
│  │  ├── generationHistory/{uid}/items/                   │  │
│  │  └── credits/{uid}/                                   │  │
│  │      ├── balance/                                     │  │
│  │      └── ledger/                                      │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Zata (S3-Compatible)                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Object Storage                                       │  │
│  │  ├── Generated Images                                 │  │
│  │  ├── Generated Videos                                 │  │
│  │  ├── Generated Audio                                  │  │
│  │  └── Processed Media                                  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Redis Cache                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Session Cache                                        │  │
│  │  ├── User Sessions                                    │  │
│  │  ├── Auth Tokens                                      │  │
│  │  └── Temporary Data                                   │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Firestore Collections

### 1. `users` Collection

**Purpose**: Store user account information and profile data.

**Document ID**: User UID (from Firebase Auth)

**Schema**:
```typescript
{
  uid: string;                    // Firebase Auth UID (document ID)
  email: string;                  // User email
  username: string;                // Unique username
  displayName?: string;            // Display name
  photoURL?: string;              // Profile photo URL
  provider: ProviderId;            // 'google' | 'password' | 'github' | 'apple' | 'username' | 'unknown'
  emailVerified: boolean;          // Email verification status
  isActive: boolean;               // Account active status
  createdAt: string;               // ISO timestamp
  lastLoginAt: string;             // ISO timestamp
  loginCount: number;              // Total login count
  lastLoginIP?: string;            // Last login IP address
  userAgent?: string;              // Last login user agent
  deviceInfo?: {                  // Device information
    browser?: string;
    os?: string;
    device?: string;
  };
  preferences?: {                 // User preferences
    theme?: 'light' | 'dark';
    language?: string;
    timezone?: string;
  };
  metadata?: {                    // Account metadata
    lastPasswordChange?: string;
    accountStatus: 'active' | 'suspended' | 'pending';
    roles?: string[];
  };
  isUsernameTemporary?: boolean;   // Temporary username flag
  updatedAt?: string;             // ISO timestamp
}
```

**Indexes**:
- `username` (for username lookup)
- `email` (for email lookup)

**Queries**:
- Get by UID: `users/{uid}`
- Get by username: `users.where('username', '==', username)`
- Get by email: `users.where('email', '==', email)`

---

### 2. `generationHistory/{uid}/items` Subcollection

**Purpose**: Store user's generation history (private, user-specific).

**Document ID**: Auto-generated Firestore ID

**Schema**:
```typescript
{
  id: string;                      // Document ID
  uid: string;                     // User ID (parent document ID)
  prompt: string;                  // Generation prompt
  model: string;                   // Model name
  generationType: GenerationType; // 'text-to-image' | 'logo' | 'sticker-generation' | 'text-to-video' | 'text-to-music' | 'mockup-generation' | 'product-generation' | 'ad-generation' | 'live-chat'
  status: GenerationStatus;        // 'generating' | 'completed' | 'failed'
  visibility: Visibility;         // 'private' | 'public' | 'unlisted'
  tags?: string[];                 // Tags for categorization
  nsfw?: boolean;                  // NSFW flag
  images?: ImageMedia[];           // Generated images
  videos?: VideoMedia[];           // Generated videos
  audios?: AudioMedia[];           // Generated audio
  frameSize?: string;             // Frame size (e.g., '1:1', '16:9')
  aspectRatio?: string;            // Aspect ratio
  aspect_ratio?: string;           // Alternative aspect ratio field
  style?: string;                  // Style parameter
  isPublic?: boolean;              // Public visibility flag
  isDeleted?: boolean;             // Soft delete flag
  error?: string;                  // Error message (if failed)
  createdBy?: {                    // Creator information
    uid: string;
    username?: string;
    email?: string;
  };
  createdAt: Timestamp;            // Server timestamp
  updatedAt: Timestamp;            // Server timestamp
  // Provider-specific fields
  provider?: string;               // 'bfl' | 'fal' | 'replicate' | 'runway' | 'minimax'
  providerTaskId?: string;         // Provider task ID
  soraVideoId?: string;            // Sora video ID (for Sora videos)
}
```

**Subcollections**: None

**Indexes**:
- `createdAt` (descending) - Default sort
- `status` + `createdAt` (composite)
- `generationType` + `createdAt` (composite)
- `provider` + `providerTaskId` (composite, for finding by provider task)
- `soraVideoId` (for Sora video lookup)

**Queries**:
- List by user: `generationHistory/{uid}/items.orderBy('createdAt', 'desc')`
- Filter by status: `generationHistory/{uid}/items.where('status', '==', 'completed')`
- Filter by type: `generationHistory/{uid}/items.where('generationType', '==', 'text-to-image')`
- Find by provider task: `generationHistory/{uid}/items.where('provider', '==', 'bfl').where('providerTaskId', '==', taskId)`

---

### 3. `generations` Collection

**Purpose**: Public generations mirror (denormalized for efficient public queries).

**Document ID**: Same as `generationHistory/{uid}/items/{historyId}`

**Schema**:
```typescript
{
  id: string;                      // Same as history item ID
  uid: string;                     // User ID
  prompt: string;                  // Generation prompt
  model: string;                   // Model name
  generationType: GenerationType; // Generation type
  status: GenerationStatus;        // Status
  visibility: Visibility;         // Visibility
  tags?: string[];                 // Tags
  nsfw?: boolean;                  // NSFW flag
  images?: ImageMedia[];           // Generated images
  videos?: VideoMedia[];           // Generated videos
  audios?: AudioMedia[];           // Generated audio
  frameSize?: string;             // Frame size
  aspectRatio?: string;            // Aspect ratio
  isPublic: boolean;               // MUST be true (filtered in queries)
  isDeleted?: boolean;             // Soft delete flag
  error?: string;                  // Error message
  createdBy: {                     // Creator information
    uid: string;
    username?: string;
    email?: string;
    displayName?: string;
    photoURL?: string;
  };
  createdAt: Timestamp;            // Server timestamp
  updatedAt: Timestamp;            // Server timestamp
  // Provider-specific fields
  provider?: string;               // Provider name
  providerTaskId?: string;         // Provider task ID
  mode?: string;                   // Runway mode (e.g., 'text_to_image')
  taskId?: string;                 // Runway task ID
  outputs?: string[];              // Runway outputs
  ratio?: string;                  // Runway ratio
  promptText?: string;             // Runway prompt
  seed?: number;                    // Runway seed
}
```

**Subcollections**: None

**Indexes**:
- `isPublic` + `createdAt` (composite, for public feed)
- `isPublic` + `status` + `createdAt` (composite)
- `isPublic` + `generationType` + `createdAt` (composite)
- `isPublic` + `createdBy.uid` + `createdAt` (composite, for user's public generations)
- `isPublic` + `createdAt` + `date range` (composite, for date filtering)

**Queries**:
- List public: `generations.where('isPublic', '==', true).orderBy('createdAt', 'desc')`
- Filter by type: `generations.where('isPublic', '==', true).where('generationType', '==', 'text-to-image')`
- Filter by creator: `generations.where('isPublic', '==', true).where('createdBy.uid', '==', uid)`

**Data Flow**:
- Created when `isPublic: true` in history item
- Updated when history item is updated
- Deleted when history item is deleted or `isPublic` becomes false

---

### 4. `redeemCodes` Collection

**Purpose**: Store redeem codes for student/business plans.

**Document ID**: Redeem code string (e.g., "STUDENT-ABC123")

**Schema**:
```typescript
{
  code: string;                    // Redeem code (document ID)
  type: RedeemCodeType;            // 'STUDENT' | 'BUSINESS'
  planCode: 'PLAN_A' | 'PLAN_C';   // PLAN_A for students, PLAN_C for business
  status: RedeemCodeStatus;        // 'ACTIVE' | 'USED' | 'EXPIRED' | 'DISABLED'
  maxUses: number;                  // Maximum number of uses
  currentUses: number;             // Current number of uses
  validUntil?: Timestamp;          // Expiration timestamp
  createdAt: Timestamp;            // Server timestamp
  updatedAt: Timestamp;            // Server timestamp
  createdBy?: string;              // Admin UID who created it
  usedBy?: string[];               // Array of user UIDs who used it
}
```

**Subcollections**: None

**Indexes**:
- `status` + `createdAt` (composite)
- `type` + `status` (composite)

**Queries**:
- Get by code: `redeemCodes/{code}`
- List active: `redeemCodes.where('status', '==', 'ACTIVE')`
- List by type: `redeemCodes.where('type', '==', 'STUDENT')`

---

### 5. `redeemCodeUsages` Collection

**Purpose**: Track redeem code usage history.

**Document ID**: Auto-generated Firestore ID

**Schema**:
```typescript
{
  redeemCode: string;              // Redeem code used
  uid: string;                     // User ID who used it
  username: string;                 // Username at time of use
  email: string;                   // Email at time of use
  planCodeAssigned: string;        // Plan code assigned (e.g., 'PLAN_A')
  creditsGranted: number;          // Credits granted
  usedAt: Timestamp;               // Server timestamp
}
```

**Subcollections**: None

**Indexes**:
- `redeemCode` + `usedAt` (composite, for code usage history)
- `uid` + `usedAt` (composite, for user's code usage)

**Queries**:
- Get usages for code: `redeemCodeUsages.where('redeemCode', '==', code).orderBy('usedAt', 'desc')`
- Get user's usages: `redeemCodeUsages.where('uid', '==', uid).orderBy('usedAt', 'desc')`

---

### 6. `replicateGenerations` Collection

**Purpose**: Track Replicate API generation jobs (legacy/temporary).

**Document ID**: Auto-generated Firestore ID

**Schema**:
```typescript
{
  prompt: string;                   // Generation prompt
  model: string;                    // Model name
  status: string;                   // 'submitted' | 'processing' | 'completed' | 'failed'
  createdBy?: {                     // Creator information
    uid: string;
    username?: string;
    email?: string;
  };
  createdAt: string;                // ISO timestamp
  updatedAt: string;                // ISO timestamp
  // Additional fields based on generation type
}
```

**Subcollections**: None

**Note**: This collection may be deprecated in favor of `generationHistory` and `generations`.

---

### 7. `credits/{uid}/balance` Subcollection

**Purpose**: Store user credit balance.

**Document ID**: Fixed document ID (e.g., "current")

**Schema**:
```typescript
{
  uid: string;                      // User ID (parent document ID)
  creditBalance: number;            // Current credit balance
  planCode: string;                 // Current plan code (e.g., 'PLAN_A', 'PLAN_B', 'PLAN_C', 'PLAN_D', 'FREE')
  createdAt: Timestamp;             // Server timestamp
  updatedAt: Timestamp;             // Server timestamp
}
```

**Subcollections**: None

**Queries**:
- Get balance: `credits/{uid}/balance/current`

---

### 8. `credits/{uid}/ledger` Subcollection

**Purpose**: Credit transaction ledger (audit trail).

**Document ID**: Auto-generated Firestore ID

**Schema**:
```typescript
{
  type: LedgerType;                 // 'GRANT' | 'DEBIT' | 'REFUND' | 'HOLD'
  amount: number;                   // Positive for GRANT/REFUND, negative for DEBIT/HOLD
  reason: string;                   // Transaction reason
  status: LedgerStatus;             // 'PENDING' | 'CONFIRMED' | 'REVERSED'
  meta?: Record<string, any>;      // Additional metadata
  createdAt: Timestamp;             // Server timestamp
}
```

**Subcollections**: None

**Indexes**:
- `createdAt` (descending) - For transaction history
- `type` + `createdAt` (composite)
- `status` + `createdAt` (composite)

**Queries**:
- List transactions: `credits/{uid}/ledger.orderBy('createdAt', 'desc')`
- Filter by type: `credits/{uid}/ledger.where('type', '==', 'DEBIT')`

---

### 9. `plans` Collection

**Purpose**: Store subscription plan definitions.

**Document ID**: Plan code (e.g., "PLAN_A", "PLAN_B", "PLAN_C", "PLAN_D", "FREE")

**Schema**:
```typescript
{
  code: string;                    // Plan code (document ID)
  name: string;                     // Plan name
  credits: number;                  // Credits included in plan
  priceInPaise: number;             // Price in paise (Indian currency)
  active: boolean;                  // Plan active status
  sort?: number;                    // Sort order
  createdAt: Timestamp;             // Server timestamp
  updatedAt: Timestamp;             // Server timestamp
}
```

**Subcollections**: None

**Queries**:
- Get plan: `plans/{planCode}`
- List active plans: `plans.where('active', '==', true).orderBy('sort')`

---

## Data Models

### ImageMedia
```typescript
{
  id: string;                      // Media ID
  url: string;                     // Public URL (Zata storage)
  storagePath: string;             // Storage path in Zata
  originalUrl?: string;            // Original provider URL (before upload)
}
```

### VideoMedia
```typescript
{
  id: string;                      // Media ID
  url: string;                     // Public URL (Zata storage)
  storagePath: string;             // Storage path in Zata
  thumbUrl?: string;               // Thumbnail URL
}
```

### AudioMedia
```typescript
{
  id: string;                      // Media ID
  url: string;                     // Public URL (Zata storage)
  storagePath?: string;            // Storage path in Zata (optional)
  originalUrl?: string;            // Original provider URL
}
```

### CreatedBy
```typescript
{
  uid: string;                     // User ID
  username?: string;               // Username
  email?: string;                  // Email
  displayName?: string;            // Display name (in generations mirror)
  photoURL?: string;               // Photo URL (in generations mirror)
}
```

---

## Relationships & Data Flow

### User → Generation History
```
users/{uid}
  └── generationHistory/{uid}/items/{historyId}
      └── (mirrored to) generations/{historyId} (if isPublic: true)
```

**Relationship**: One-to-many (user has many generation history items)

**Data Flow**:
1. User creates generation → `generationHistory/{uid}/items/{historyId}` created
2. If `isPublic: true` → `generations/{historyId}` created/updated via mirror repository
3. Generation updates → Both collections updated
4. Generation deleted → `isDeleted: true` set in both collections

### User → Credits
```
users/{uid}
  └── credits/{uid}/
      ├── balance/current
      └── ledger/{transactionId}
```

**Relationship**: One-to-one (balance), One-to-many (ledger)

**Data Flow**:
1. User redeems code → Credits granted → Ledger entry created → Balance updated
2. User generates content → Credits debited → Ledger entry created → Balance updated
3. All credit operations are atomic (Firestore batch)

### Redeem Code → Usage
```
redeemCodes/{code}
  └── (referenced by) redeemCodeUsages/{usageId}
```

**Relationship**: One-to-many (code can be used multiple times)

**Data Flow**:
1. User redeems code → `redeemCodeUsages` entry created → `redeemCodes/{code}` updated (currentUses++, usedBy array updated)

### Generation → Media Storage
```
generationHistory/{uid}/items/{historyId}
  └── images[] / videos[] / audios[]
      └── (stored in) Zata Storage
          └── storagePath: "generations/{uid}/{historyId}/{mediaId}.{ext}"
```

**Relationship**: One-to-many (generation has multiple media files)

**Data Flow**:
1. Generation completed → Media URLs from provider
2. Media uploaded to Zata → `storagePath` set
3. `url` field updated to Zata public URL

---

## Indexing Strategy

### Composite Indexes Required

**generationHistory/{uid}/items**:
1. `status` + `createdAt` (descending)
2. `generationType` + `createdAt` (descending)
3. `status` + `generationType` + `createdAt` (descending)
4. `provider` + `providerTaskId`
5. `soraVideoId`

**generations**:
1. `isPublic` + `createdAt` (descending)
2. `isPublic` + `status` + `createdAt` (descending)
3. `isPublic` + `generationType` + `createdAt` (descending)
4. `isPublic` + `createdBy.uid` + `createdAt` (descending)
5. `isPublic` + `createdAt` (for date range queries)

**credits/{uid}/ledger**:
1. `type` + `createdAt` (descending)
2. `status` + `createdAt` (descending)

**redeemCodeUsages**:
1. `redeemCode` + `usedAt` (descending)
2. `uid` + `usedAt` (descending)

### Single-Field Indexes

- `users.username` (for username lookup)
- `users.email` (for email lookup)
- `redeemCodes.status` (for active code queries)
- `redeemCodes.type` (for type filtering)

---

## System Design Patterns

### 1. Repository Pattern

**Purpose**: Abstract database operations from business logic.

**Implementation**:
- Each collection has a dedicated repository file
- Repositories handle all Firestore operations
- Services use repositories, not direct Firestore access

**Example**:
```typescript
// Repository
export const generationHistoryRepository = {
  create,
  update,
  get,
  list,
  findByProviderTaskId,
};

// Service
const historyId = await generationHistoryRepository.create(uid, data);
```

### 2. Mirror Pattern

**Purpose**: Denormalize public data for efficient queries.

**Implementation**:
- `generationHistory/{uid}/items` = Source of truth (private)
- `generations` = Public mirror (denormalized)
- `generationsMirrorRepository` handles sync

**Benefits**:
- Fast public feed queries (no user subcollection traversal)
- Efficient filtering and pagination
- Reduced query complexity

**Trade-offs**:
- Data duplication
- Requires sync logic
- More storage cost

### 3. Subcollection Pattern

**Purpose**: Scale user-specific data efficiently.

**Implementation**:
- User data in subcollections: `generationHistory/{uid}/items`
- Each user's data isolated
- No cross-user queries needed

**Benefits**:
- Automatic sharding by user
- Efficient queries (single user scope)
- Better security (user can only access their subcollection)

### 4. Soft Delete Pattern

**Purpose**: Preserve data while hiding it from queries.

**Implementation**:
- `isDeleted: boolean` field
- Queries filter: `.where('isDeleted', '!=', true)` or `.filter(item => !item.isDeleted)`
- No actual document deletion

**Benefits**:
- Data recovery possible
- Audit trail maintained
- Referential integrity preserved

### 5. Batch Operations Pattern

**Purpose**: Ensure atomic updates across multiple documents.

**Implementation**:
- Firestore batch for multi-document updates
- Used in credit operations (balance + ledger)
- Used in redeem code operations (code + usage)

**Example**:
```typescript
const batch = adminDb.batch();
batch.update(balanceRef, { creditBalance: newBalance });
batch.set(ledgerRef, ledgerEntry);
await batch.commit();
```

### 6. Server Timestamps Pattern

**Purpose**: Ensure consistent timestamps across all clients.

**Implementation**:
- `admin.firestore.FieldValue.serverTimestamp()` for `createdAt` and `updatedAt`
- No client-side timestamps

**Benefits**:
- Consistent timezone
- No clock skew issues
- Server-controlled timestamps

---

## Storage Architecture

### Zata (S3-Compatible) Storage

**Structure**:
```
zata-bucket/
├── generations/
│   ├── {uid}/
│   │   ├── {historyId}/
│   │   │   ├── {mediaId}.jpg
│   │   │   ├── {mediaId}.mp4
│   │   │   └── {mediaId}.mp3
│   │   └── ...
│   └── ...
└── ...
```

**File Naming**:
- Images: `{mediaId}.jpg` or `{mediaId}.png`
- Videos: `{mediaId}.mp4`
- Audio: `{mediaId}.mp3`

**URL Format**:
- Public URL: `https://zata-storage-url.com/generations/{uid}/{historyId}/{mediaId}.{ext}`

**Upload Flow**:
1. Provider returns temporary URL
2. Download from provider
3. Upload to Zata with structured path
4. Update Firestore with Zata URL and `storagePath`

---

## Caching Strategy

### Redis Cache

**Purpose**: Cache session data and frequently accessed information.

**Cached Data**:
- User sessions (Firebase Auth tokens)
- User profile data (temporary)
- Plan definitions (temporary)

**Cache Keys**:
- `session:{uid}` - User session
- `user:{uid}` - User profile
- `plans` - Plan definitions

**TTL**:
- Sessions: 24 hours
- User profiles: 1 hour
- Plans: 1 day

### Firestore Cache

**Purpose**: Client-side caching for offline support.

**Implementation**:
- Firestore SDK handles caching automatically
- Offline persistence enabled
- Cache-first for reads

---

## Data Consistency

### Eventual Consistency

**Firestore**: Eventually consistent (within seconds)

**Handling**:
- Retry logic for critical operations
- Optimistic updates in UI
- Polling for status updates (generations)

### Strong Consistency

**Where Needed**:
- Credit balance updates (batch operations)
- Redeem code usage (batch operations)
- User creation (single document)

**Implementation**:
- Firestore transactions for critical paths
- Batch writes for multi-document updates

### Data Synchronization

**Mirror Sync**:
- `generationsMirrorRepository.upsertFromHistory()` - Creates/updates mirror
- `generationsMirrorRepository.updateFromHistory()` - Updates mirror
- `generationsMirrorRepository.remove()` - Removes from mirror

**Sync Triggers**:
- When `isPublic` changes in history item
- When history item is updated
- When history item is deleted

---

## Query Patterns

### Pagination

**Cursor-Based Pagination**:
```typescript
// First page
const snapshot = await collection
  .orderBy('createdAt', 'desc')
  .limit(20)
  .get();

// Next page
const nextSnapshot = await collection
  .orderBy('createdAt', 'desc')
  .startAfter(lastDoc)
  .limit(20)
  .get();
```

**Cursor Storage**:
- Client stores last document ID
- Server uses `startAfter()` for next page

### Filtering

**Status Filtering**:
```typescript
collection.where('status', '==', 'completed')
```

**Type Filtering**:
```typescript
collection.where('generationType', '==', 'text-to-image')
```

**Date Range Filtering**:
```typescript
collection
  .where('createdAt', '>=', startDate)
  .where('createdAt', '<=', endDate)
```

**Composite Filtering**:
```typescript
collection
  .where('isPublic', '==', true)
  .where('status', '==', 'completed')
  .where('generationType', '==', 'text-to-image')
  .orderBy('createdAt', 'desc')
```

### Search

**Text Search**:
- Client-side filtering (Firestore doesn't support full-text search)
- Filter by prompt substring: `items.filter(item => item.prompt.toLowerCase().includes(searchTerm))`

**Future**: Consider Algolia or Elasticsearch for full-text search

---

## Security Rules

### Firestore Security Rules

**Users Collection**:
- Read: Authenticated users can read their own document
- Write: Only server (admin SDK) can write

**Generation History**:
- Read: Users can only read their own history
- Write: Only server can write

**Generations (Public)**:
- Read: Anyone can read public generations
- Write: Only server can write

**Credits**:
- Read: Users can only read their own credits
- Write: Only server can write

**Redeem Codes**:
- Read: Only server can read
- Write: Only server can write

---

## Performance Optimizations

### Query Optimization

1. **Index All Query Fields**: Ensure composite indexes exist
2. **Limit Results**: Always use `.limit()` to reduce data transfer
3. **Selective Fields**: Use `.select()` to fetch only needed fields
4. **Pagination**: Use cursor-based pagination for large datasets

### Write Optimization

1. **Batch Writes**: Group multiple writes in a single batch
2. **Server Timestamps**: Use server timestamps to avoid client round-trips
3. **Minimal Updates**: Only update changed fields

### Storage Optimization

1. **Image Compression**: Compress images before upload
2. **Video Optimization**: Use appropriate video codecs
3. **CDN**: Use CDN for media delivery

---

## Monitoring & Maintenance

### Key Metrics

1. **Read Operations**: Monitor Firestore read counts
2. **Write Operations**: Monitor Firestore write counts
3. **Storage Usage**: Monitor Firestore storage and Zata storage
4. **Query Performance**: Monitor slow queries
5. **Error Rates**: Monitor failed operations

### Maintenance Tasks

1. **Index Creation**: Create composite indexes as needed
2. **Data Cleanup**: Periodically clean up soft-deleted items (optional)
3. **Storage Cleanup**: Remove orphaned files from Zata
4. **Cache Invalidation**: Clear Redis cache when data changes

---

## Future Considerations

### Scalability

1. **Sharding**: Consider sharding `generations` collection by date
2. **Archiving**: Archive old generation history to cold storage
3. **Partitioning**: Partition large collections by region

### Features

1. **Full-Text Search**: Integrate Algolia/Elasticsearch
2. **Analytics**: Add analytics collection for usage tracking
3. **Backup**: Implement automated Firestore backups
4. **Replication**: Consider multi-region replication

---

## Conclusion

The WildMind API Gateway database architecture is designed for scalability, performance, and maintainability. The use of Firestore subcollections, denormalized mirrors, and efficient indexing strategies ensures fast queries and smooth user experiences. The system follows best practices for NoSQL databases while maintaining data consistency where needed.

