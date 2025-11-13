# Firestore Indexes Required for Canvas

This document lists all Firestore composite indexes required for the Canvas backend to function properly.

## How to Create Indexes

1. **Via Firebase Console:**
   - Go to Firebase Console → Firestore → Indexes
   - Click "Create Index"
   - Fill in the collection and fields as specified below

2. **Via Firebase CLI:**
   - Create a `firestore.indexes.json` file (see below)
   - Run: `firebase deploy --only firestore:indexes`

3. **Auto-generated:**
   - Firestore will sometimes provide a link in error messages
   - Click the link to create the index automatically

## Required Indexes

### 1. Canvas Projects - List by Owner and Updated Date

**Collection:** `canvasProjects`

**Fields:**
- `ownerUid` (Ascending)
- `updatedAt` (Descending)

**Query:** Used by `listUserProjects()` to get user's projects ordered by most recent

**firestore.indexes.json:**
```json
{
  "indexes": [
    {
      "collectionGroup": "canvasProjects",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "ownerUid",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "updatedAt",
          "order": "DESCENDING"
        }
      ]
    }
  ]
}
```

### 2. Canvas Operations - List by Op Index

**Collection:** `canvasProjects/{projectId}/ops`

**Fields:**
- `opIndex` (Ascending)

**Query:** Used by `listOps()` to get operations in order

**Note:** This is a subcollection, so the index path is `canvasProjects/{projectId}/ops`

**firestore.indexes.json:**
```json
{
  "indexes": [
    {
      "collectionGroup": "ops",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        {
          "fieldPath": "opIndex",
          "order": "ASCENDING"
        }
      ]
    }
  ]
}
```

### 3. Canvas Media - Unreferenced Media Query

**Collection:** `canvasMedia`

**Fields:**
- `referencedByCount` (Ascending)
- `createdAt` (Ascending)

**Query:** Used by `getUnreferencedMedia()` to find media that can be garbage collected

**firestore.indexes.json:**
```json
{
  "indexes": [
    {
      "collectionGroup": "canvasMedia",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "referencedByCount",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "createdAt",
          "order": "ASCENDING"
        }
      ]
    }
  ]
}
```

### 4. Canvas Elements - Spatial Queries (Optional)

**Collection:** `canvasProjects/{projectId}/elements`

**Fields:**
- `x` (Ascending)
- `y` (Ascending)

**Query:** Used by `queryElementsInRegion()` for spatial queries

**Note:** This is optional if you're not using spatial queries. Firestore will create it automatically when needed, or you can create it manually.

**firestore.indexes.json:**
```json
{
  "indexes": [
    {
      "collectionGroup": "elements",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        {
          "fieldPath": "x",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "y",
          "order": "ASCENDING"
        }
      ]
    }
  ]
}
```

## Complete firestore.indexes.json

```json
{
  "indexes": [
    {
      "collectionGroup": "canvasProjects",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "ownerUid",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "updatedAt",
          "order": "DESCENDING"
        }
      ]
    },
    {
      "collectionGroup": "ops",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        {
          "fieldPath": "opIndex",
          "order": "ASCENDING"
        }
      ]
    },
    {
      "collectionGroup": "canvasMedia",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "referencedByCount",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "createdAt",
          "order": "ASCENDING"
        }
      ]
    },
    {
      "collectionGroup": "elements",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        {
          "fieldPath": "x",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "y",
          "order": "ASCENDING"
        }
      ]
    }
  ],
  "fieldOverrides": []
}
```

## Verification

After creating indexes, verify they're working by:

1. **Testing queries:**
   - Run the repository functions that use these queries
   - Check for any index-related errors in logs

2. **Firebase Console:**
   - Go to Firestore → Indexes
   - Verify all indexes show "Enabled" status

3. **Error Messages:**
   - If you see "The query requires an index" errors, Firestore will provide a link
   - Click the link to create the missing index

## Notes

- Indexes can take a few minutes to build, especially for large collections
- You may see "index building" status in Firebase Console
- Queries will fail until indexes are ready
- Single-field indexes are created automatically, only composite indexes need manual creation

