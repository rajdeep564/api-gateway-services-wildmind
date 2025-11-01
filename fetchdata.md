# Fetch User Data Guide

This guide explains how to fetch user data (uid, email, username, etc.) from your Firestore database.

## Current Data Structure

Your users are stored in collections named after their **email prefix** (part before @):
```
Collection: ayushchaudhary1104/
  Document: userData/
    - uid: "firebase-user-id"
    - email: "ayushchaudhary1104@gmail.com"  
    - username: "av123"
    - provider: "password"
    - createdAt: "2025-09-19T09:12:55.294Z"
    - lastLoginAt: "2025-09-19T09:12:55.294Z"
    - loginCount: 1
    - emailVerified: true
    - isActive: true
    - preferences: { theme: "light", language: "en" }
    - metadata: { accountStatus: "active", roles: ["user"] }
```

## 1. Fetch User by Email

### Using Repository Function:
```typescript
import { authRepository } from './repository/auth/authRepository';

// Fetch user by email
const userResult = await authRepository.getUserByEmail('ayushchaudhary1104@gmail.com');
if (userResult) {
  const { uid, user } = userResult;
  console.log('UID:', uid);
  console.log('Email:', user.email);
  console.log('Username:', user.username);
  console.log('All user data:', user);
}
```

### Direct Firestore Query:
```typescript
import { adminDb } from './config/firebaseAdmin';

const email = 'ayushchaudhary1104@gmail.com';
const emailPrefix = email.split('@')[0]; // 'ayushchaudhary1104'

const userRef = adminDb.collection(emailPrefix).doc('userData');
const userSnap = await userRef.get();

if (userSnap.exists) {
  const userData = userSnap.data();
  console.log('UID:', userData.uid);
  console.log('Email:', userData.email);
  console.log('Username:', userData.username);
}
```

## 2. Fetch User by Username

### Using Repository Function:
```typescript
import { authRepository } from './repository/auth/authRepository';

const user = await authRepository.getUserByUsername('av123');
if (user) {
  console.log('UID:', user.uid);
  console.log('Email:', user.email);
  console.log('Username:', user.username);
}
```

## 3. Fetch User by UID

### Using Repository Function:
```typescript
import { authRepository } from './repository/auth/authRepository';

const user = await authRepository.getUserById('firebase-user-id');
if (user) {
  console.log('UID:', user.uid);
  console.log('Email:', user.email);
  console.log('Username:', user.username);
}
```

## 4. Fetch Specific Fields Only

### Get Only Email and Username:
```typescript
const email = 'ayushchaudhary1104@gmail.com';
const emailPrefix = email.split('@')[0];

const userRef = adminDb.collection(emailPrefix).doc('userData');
const userSnap = await userRef.get();

if (userSnap.exists) {
  const userData = userSnap.data();
  const specificData = {
    email: userData.email,
    username: userData.username
  };
  console.log('Specific data:', specificData);
}
```

### Get Only UID and Login Count:
```typescript
const userResult = await authRepository.getUserByEmail('ayushchaudhary1104@gmail.com');
if (userResult) {
  const specificData = {
    uid: userResult.user.uid,
    loginCount: userResult.user.loginCount
  };
  console.log('UID and Login Count:', specificData);
}
```

## 5. API Endpoints for Fetching Data

### Current User (requires authentication):
```bash
GET /api/me
Authorization: Cookie with session
```

### Resolve Email by Username:
```bash
GET /api/auth/resolve-email?id=av123
```

## 6. Custom Fetch Function

Create a utility function for flexible data fetching:

```typescript
// utils/fetchUserData.ts
import { adminDb } from '../config/firebaseAdmin';

interface FetchOptions {
  fields?: string[]; // Specific fields to return
}

export async function fetchUserByEmail(email: string, options?: FetchOptions) {
  const emailPrefix = email.split('@')[0];
  const userRef = adminDb.collection(emailPrefix).doc('userData');
  const userSnap = await userRef.get();
  
  if (!userSnap.exists) {
    return null;
  }
  
  const userData = userSnap.data();
  
  // Return specific fields if requested
  if (options?.fields) {
    const result: any = {};
    options.fields.forEach(field => {
      result[field] = userData[field];
    });
    return result;
  }
  
  // Return all data
  return userData;
}

// Usage examples:
// Get all data: await fetchUserByEmail('user@gmail.com')
// Get specific fields: await fetchUserByEmail('user@gmail.com', { fields: ['uid', 'username'] })
```

## 7. Common Use Cases

### Check if User Exists:
```typescript
const userExists = await authRepository.getUserByEmail('test@gmail.com') !== null;
```

### Get User's Last Login:
```typescript
const user = await authRepository.getUserByEmail('user@gmail.com');
const lastLogin = user?.user.lastLoginAt;
```

### Get All User Preferences:
```typescript
const user = await authRepository.getUserByEmail('user@gmail.com');
const preferences = user?.user.preferences;
```

### Count Total Logins:
```typescript
const user = await authRepository.getUserByEmail('user@gmail.com');
const totalLogins = user?.user.loginCount || 0;
```

## 8. Error Handling

Always wrap database calls in try-catch:

```typescript
try {
  const user = await authRepository.getUserByEmail('user@gmail.com');
  if (!user) {
    console.log('User not found');
    return;
  }
  
  console.log('User data:', user.user);
} catch (error) {
  console.error('Error fetching user:', error);
}
```

## Available Fields

Your user documents contain these fields:
- `uid` - Firebase user ID
- `email` - User's email address
- `username` - Chosen username
- `provider` - Authentication provider ('google', 'password', etc.)
- `createdAt` - Account creation timestamp
- `lastLoginAt` - Last login timestamp
- `loginCount` - Number of times logged in
- `emailVerified` - Email verification status
- `isActive` - Account active status
- `lastLoginIP` - Last login IP address
- `userAgent` - Last login user agent
- `deviceInfo` - Device information
- `preferences` - User preferences (theme, language)
- `metadata` - Account metadata (status, roles)
- `displayName` - Display name (for Google users)
- `photoURL` - Profile photo URL (for Google users)
