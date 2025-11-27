# Library and Uploads API Routes

## Overview

New backend routes have been created to serve library and upload sections directly from the backend, replacing the previous cache-based approach. These routes support pagination and mode filtering.

## Endpoints

### 1. GET `/api/library`

Get user's generated media library (images and videos from completed generations).

**Query Parameters:**
- `limit` (optional, default: 50, max: 100): Number of items to return
- `cursor` (optional): Legacy cursor for pagination
- `nextCursor` (optional): Timestamp-based cursor for pagination
- `mode` (optional): Filter by mode - `image`, `video`, `music`, `branding`, or `all` (default: `all`)

**Response:**
```json
{
  "responseStatus": "success",
  "message": "Library retrieved",
  "data": {
    "items": [
      {
        "id": "historyId-mediaId",
        "historyId": "abc123",
        "url": "https://...",
        "type": "image" | "video",
        "thumbnail": "https://...",
        "prompt": "User prompt",
        "model": "model-name",
        "createdAt": "2025-01-20T10:00:00.000Z",
        "storagePath": "users/username/image/...",
        "mediaId": "media-id",
        "aspectRatio": "16:9",
        "aestheticScore": 8.5
      }
    ],
    "nextCursor": "1763641262371",
    "hasMore": true
  }
}
```

**Usage Example:**
```typescript
// Fetch first page of image library
const response = await fetch('/api/library?limit=50&mode=image', {
  credentials: 'include'
});

// Fetch next page
const nextPage = await fetch(`/api/library?limit=50&mode=image&nextCursor=${nextCursor}`, {
  credentials: 'include'
});
```

### 2. GET `/api/uploads`

Get user's uploaded media (inputImages and inputVideos from generation history).

**Query Parameters:**
- `limit` (optional, default: 50, max: 100): Number of items to return
- `cursor` (optional): Legacy cursor for pagination
- `nextCursor` (optional): Timestamp-based cursor for pagination
- `mode` (optional): Filter by mode - `image`, `video`, `music`, `branding`, or `all` (default: `all`)

**Response:**
```json
{
  "responseStatus": "success",
  "message": "Uploads retrieved",
  "data": {
    "items": [
      {
        "id": "historyId-input-mediaId",
        "historyId": "abc123",
        "url": "https://...",
        "type": "image" | "video",
        "thumbnail": "https://...",
        "prompt": "User prompt",
        "model": "model-name",
        "createdAt": "2025-01-20T10:00:00.000Z",
        "storagePath": "users/username/input/...",
        "mediaId": "media-id",
        "originalUrl": "https://..."
      }
    ],
    "nextCursor": "1763641262371",
    "hasMore": true
  }
}
```

**Usage Example:**
```typescript
// Fetch first page of uploads
const response = await fetch('/api/uploads?limit=50&mode=image', {
  credentials: 'include'
});

// Fetch next page
const nextPage = await fetch(`/api/uploads?limit=50&mode=image&nextCursor=${nextCursor}`, {
  credentials: 'include'
});
```

## Mode Filtering

The `mode` parameter filters results based on generation type:

- `image`: Returns only image-related generations (text-to-image, image-to-image, logo, sticker, etc.)
- `video`: Returns only video-related generations (text-to-video, image-to-video, etc.)
- `music`: Returns only music/audio-related generations (text-to-music, text-to-speech, etc.)
- `branding`: Returns only branding-related generations (logo, sticker, product, mockup, ad)
- `all`: Returns all types (default)

## Pagination

Both endpoints support cursor-based pagination:

1. **Initial Request**: Omit `nextCursor` to get the first page
2. **Subsequent Requests**: Use the `nextCursor` value from the previous response
3. **Check for More**: Use the `hasMore` boolean to determine if more items are available

## Migration from Cache-Based Approach

### Before (Cache-Based):
```typescript
// Frontend used Redux cache
const historyEntries = useAppSelector(state => state.history.entries);
// Filtered client-side
const libraryItems = historyEntries.filter(/* ... */);
const uploadItems = historyEntries.filter(entry => entry.inputImages?.length > 0);
```

### After (Backend Routes):
```typescript
// Fetch directly from backend
const fetchLibrary = async (limit = 50, cursor?: string, mode?: string) => {
  const params = new URLSearchParams({
    limit: String(limit),
    ...(cursor && { nextCursor: cursor }),
    ...(mode && { mode }),
  });
  const response = await fetch(`/api/library?${params}`, {
    credentials: 'include',
  });
  return response.json();
};

const fetchUploads = async (limit = 50, cursor?: string, mode?: string) => {
  const params = new URLSearchParams({
    limit: String(limit),
    ...(cursor && { nextCursor: cursor }),
    ...(mode && { mode }),
  });
  const response = await fetch(`/api/uploads?${params}`, {
    credentials: 'include',
  });
  return response.json();
};
```

## Benefits

1. **Direct Backend Access**: No dependency on Redux cache state
2. **Pagination**: Efficient loading of large datasets
3. **Mode Filtering**: Server-side filtering reduces data transfer
4. **Consistency**: Always returns fresh data from database
5. **Performance**: Only fetches what's needed, when needed

## Implementation Files

- **Routes**: `api-gateway-services-wildmind/src/routes/library.ts`
- **Controller**: `api-gateway-services-wildmind/src/controllers/libraryController.ts`
- **Validation**: `api-gateway-services-wildmind/src/middlewares/validators/library/validateLibrary.ts`

