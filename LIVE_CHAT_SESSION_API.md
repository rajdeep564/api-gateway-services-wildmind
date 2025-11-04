# Live Chat Session API Documentation

## Overview

This API manages live chat sessions where images are linked together in sequence. When a user uploads an image and starts editing it (creating multiple versions), all images from that session are linked together. When clicking on any image from a session, the entire session can be restored.

## Database Structure

### Collection: `liveChatSessions`

Each document contains:
- `sessionId`: Unique session identifier (client-generated)
- `uid`: User ID who owns the session
- `model`: Model used for generation
- `frameSize`: Optional frame size
- `style`: Optional style
- `startedAt`: Timestamp when session started
- `completedAt`: Timestamp when session completed (optional)
- `status`: 'active' | 'completed' | 'failed'
- `messages`: Array of messages with images in chronological order
  - Each message has: `prompt`, `images[]`, `timestamp`
  - Each image has: `id`, `url`, `storagePath`, `originalUrl`, `firebaseUrl`, `order` (1, 2, 3, ...)
- `imageUrls`: Array of all image URLs in sequence (for quick lookup)
- `imageOrderMap`: Object mapping imageUrl -> order number (for quick lookup)
- `totalImages`: Total count of images
- `createdAt`: Timestamp when document was created
- `updatedAt`: Timestamp when document was last updated

## API Endpoints

All endpoints require authentication via `requireAuth` middleware.

### 1. Create Session

**POST** `/api/live-chat-sessions`

Creates a new live chat session.

**Request Body:**
```json
{
  "sessionId": "session-1234567890",
  "model": "flux-kontext-pro",
  "frameSize": "1024x1024",
  "style": "anime",
  "startedAt": "2025-01-15T10:00:00.000Z"
}
```

**Response:**
```json
{
  "status": "success",
  "message": "Session created",
  "data": {
    "sessionDocId": "firestore-doc-id"
  }
}
```

### 2. Find or Create Session

**POST** `/api/live-chat-sessions/find-or-create`

Finds an existing session by `sessionId` or creates a new one if it doesn't exist.

**Request Body:**
```json
{
  "sessionId": "session-1234567890",
  "model": "flux-kontext-pro",
  "frameSize": "1024x1024",
  "style": "anime",
  "startedAt": "2025-01-15T10:00:00.000Z"
}
```

**Response:**
```json
{
  "status": "success",
  "message": "OK",
  "data": {
    "sessionDocId": "firestore-doc-id"
  }
}
```

### 3. Add Message to Session

**POST** `/api/live-chat-sessions/:sessionDocId/messages`

Adds a new message with images to an existing session. Images are automatically assigned order numbers (continuing from the last order).

**Request Body:**
```json
{
  "prompt": "Make the sky more blue",
  "images": [
    {
      "id": "img-1",
      "url": "https://zata.ai/storage/image1.png",
      "storagePath": "users/uid/image1.png",
      "originalUrl": "https://zata.ai/storage/image1.png",
      "firebaseUrl": "https://firebase.storage/image1.png"
    }
  ],
  "timestamp": "2025-01-15T10:05:00.000Z"
}
```

**Response:**
```json
{
  "status": "success",
  "message": "Message added",
  "data": {}
}
```

### 4. Get Session by Document ID

**GET** `/api/live-chat-sessions/:sessionDocId`

Retrieves a session by its Firestore document ID.

**Response:**
```json
{
  "status": "success",
  "message": "OK",
  "data": {
    "session": {
      "id": "firestore-doc-id",
      "sessionId": "session-1234567890",
      "uid": "user-123",
      "model": "flux-kontext-pro",
      "status": "active",
      "messages": [...],
      "imageUrls": ["url1", "url2", "url3"],
      "imageOrderMap": { "url1": 1, "url2": 2, "url3": 3 },
      "totalImages": 3,
      ...
    }
  }
}
```

### 5. Get Session by Image URL ⭐ **KEY ENDPOINT**

**GET** `/api/live-chat-sessions/by-image-url?imageUrl=...`

This is the **key endpoint** for restoring sessions when clicking on an image. It finds the session that contains the given image URL.

**Query Parameters:**
- `imageUrl` (required): The URL of the image to find the session for

**Example:**
```
GET /api/live-chat-sessions/by-image-url?imageUrl=https://zata.ai/storage/image2.png
```

**Response:**
```json
{
  "status": "success",
  "message": "OK",
  "data": {
    "session": {
      "id": "firestore-doc-id",
      "sessionId": "session-1234567890",
      "uid": "user-123",
      "model": "flux-kontext-pro",
      "status": "completed",
      "messages": [
        {
          "prompt": "Initial image",
          "images": [
            {
              "id": "img-1",
              "url": "https://zata.ai/storage/image1.png",
              "order": 1
            }
          ],
          "timestamp": "2025-01-15T10:00:00.000Z"
        },
        {
          "prompt": "Make sky blue",
          "images": [
            {
              "id": "img-2",
              "url": "https://zata.ai/storage/image2.png",
              "order": 2
            }
          ],
          "timestamp": "2025-01-15T10:05:00.000Z"
        }
      ],
      "imageUrls": ["url1", "url2"],
      "imageOrderMap": { "url1": 1, "url2": 2 },
      "totalImages": 2,
      ...
    }
  }
}
```

### 6. List Sessions

**GET** `/api/live-chat-sessions?limit=20&cursor=...&status=completed`

Lists all sessions for the current user.

**Query Parameters:**
- `limit` (optional): Number of results (default: 20)
- `cursor` (optional): Pagination cursor
- `status` (optional): Filter by status ('active' | 'completed' | 'failed')

**Response:**
```json
{
  "status": "success",
  "message": "OK",
  "data": {
    "sessions": [...],
    "nextCursor": "doc-id-for-next-page"
  }
}
```

### 7. Complete Session

**PATCH** `/api/live-chat-sessions/:sessionDocId/complete`

Marks a session as completed.

**Request Body:**
```json
{
  "completedAt": "2025-01-15T10:30:00.000Z"
}
```

**Response:**
```json
{
  "status": "success",
  "message": "Session completed",
  "data": {}
}
```

### 8. Update Session

**PATCH** `/api/live-chat-sessions/:sessionDocId`

Updates a session with new data.

**Request Body:**
```json
{
  "status": "completed",
  "completedAt": "2025-01-15T10:30:00.000Z"
}
```

## Frontend Integration Flow

### 1. Starting a Live Chat Session

When user uploads an image:
```typescript
// 1. Create or find session
const response = await fetch('/api/live-chat-sessions/find-or-create', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({
    sessionId: `session-${Date.now()}`,
    model: selectedModel,
    frameSize: frameSize,
    style: style,
    startedAt: new Date().toISOString()
  })
});
const { sessionDocId } = await response.json();
```

### 2. Adding Images to Session

After each generation:
```typescript
// Add message with new image
await fetch(`/api/live-chat-sessions/${sessionDocId}/messages`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({
    prompt: prompt,
    images: generatedImages.map(img => ({
      id: img.id,
      url: img.url,
      storagePath: img.storagePath,
      originalUrl: img.originalUrl,
      firebaseUrl: img.firebaseUrl
    })),
    timestamp: new Date().toISOString()
  })
});
```

### 3. Completing Session

When user clicks "Done":
```typescript
// Complete session
await fetch(`/api/live-chat-sessions/${sessionDocId}/complete`, {
  method: 'PATCH',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({
    completedAt: new Date().toISOString()
  })
});
```

### 4. Restoring Session from Image Click

When user clicks on an image in history:
```typescript
// Get session by image URL
const response = await fetch(
  `/api/live-chat-sessions/by-image-url?imageUrl=${encodeURIComponent(imageUrl)}`,
  {
    headers: { 'Authorization': `Bearer ${token}` }
  }
);
const { session } = await response.json();

// Restore session state
// session.imageUrls contains all image URLs in order
// session.messages contains all messages with prompts
// session.imageOrderMap maps imageUrl -> order number

// Restore all images in sequence
const allImages = session.imageUrls.map((url: string) => {
  // Find image details from messages
  for (const msg of session.messages) {
    const img = msg.images.find((i: any) => i.url === url);
    if (img) return img;
  }
  return null;
}).filter(Boolean);

// Sort by order
allImages.sort((a, b) => a.order - b.order);

// Restore session in UI
setSessionImages(allImages.slice(0, -1)); // Previous images
setCurrentGeneration({ images: [allImages[allImages.length - 1]] }); // Latest image
```

## Database Indexes Required

Create these Firestore indexes for optimal performance:

1. **Collection:** `liveChatSessions`
   - **Fields:** `uid` (Ascending), `updatedAt` (Descending)
   - **Query Scope:** Collection

2. **Collection:** `liveChatSessions`
   - **Fields:** `uid` (Ascending), `status` (Ascending), `updatedAt` (Descending)
   - **Query Scope:** Collection

3. **Collection:** `liveChatSessions`
   - **Fields:** `imageUrls` (Array), `updatedAt` (Descending)
   - **Query Scope:** Collection

## Notes

- Images are stored in Zata storage
- Session metadata is stored in Firebase Firestore
- Image URLs are indexed in `imageUrls` array for fast lookup
- Each image has an `order` field (1, 2, 3, ...) to maintain sequence
- `imageOrderMap` provides O(1) lookup of image order by URL
- All timestamps are stored as Firestore Timestamps and converted to ISO strings in responses

