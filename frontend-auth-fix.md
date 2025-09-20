# Frontend Authentication Fix

## Problem
The frontend is sending `Bearer undefined` instead of using session cookies that the backend expects.

## Current Backend Authentication Flow
1. **Login**: `POST /api/auth/session` - Sets `app_session` cookie
2. **Protected Routes**: `GET /api/me` - Reads `app_session` cookie

## Solution 1: Fix Frontend to Use Session Cookies (Recommended)

### Frontend Login Flow:
```javascript
// After Google/Email login, get the Firebase ID token
const idToken = await user.getIdToken();

// Send to backend to create session
const response = await fetch('http://localhost:5000/api/auth/session', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  credentials: 'include', // IMPORTANT: Include cookies
  body: JSON.stringify({ idToken })
});

if (response.ok) {
  // Session cookie is automatically set by backend
  console.log('Session created successfully');
}
```

### Frontend API Calls:
```javascript
// For all subsequent API calls, include credentials
const fetchUserData = async () => {
  const response = await fetch('http://localhost:5000/api/me', {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include', // IMPORTANT: Include cookies
  });
  
  if (response.ok) {
    const data = await response.json();
    return data.data.user;
  }
};
```

### Frontend Logout:
```javascript
const logout = async () => {
  await fetch('http://localhost:5000/api/logout', {
    method: 'POST',
    credentials: 'include', // IMPORTANT: Include cookies
  });
  
  // Also sign out from Firebase
  await signOut(auth);
};
```

### CORS Configuration Required:
Your backend needs to allow credentials. Update your CORS config:

```javascript
// In your Express app
app.use(cors({
  origin: 'http://localhost:3000', // Your frontend URL
  credentials: true // Allow cookies
}));
```

## Solution 2: Add Bearer Token Support to Backend

If you prefer to use Authorization headers, add this middleware:

```javascript
// src/middlewares/authMiddleware.ts
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    let token: string | undefined;
    
    // Try to get token from cookie first (existing method)
    token = req.cookies?.[COOKIE_NAME];
    
    // If no cookie, try Authorization header
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7); // Remove 'Bearer ' prefix
      }
    }
    
    if (!token) {
      throw new ApiError('Unauthorized - No session token', 401);
    }
    
    const decoded = await admin.auth().verifyIdToken(token);
    (req as any).uid = decoded.uid;
    return next();
  } catch (error) {
    if (error instanceof ApiError) {
      return next(error);
    }
    return next(new ApiError('Unauthorized - Invalid token', 401));
  }
}
```

### Frontend with Bearer Token:
```javascript
// Store token in localStorage after login
const idToken = await user.getIdToken();
localStorage.setItem('authToken', idToken);

// Use token in API calls
const fetchUserData = async () => {
  const token = localStorage.getItem('authToken');
  
  const response = await fetch('http://localhost:5000/api/me', {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  });
  
  if (response.ok) {
    const data = await response.json();
    return data.data.user;
  }
};
```

## Recommended Approach

**Use Solution 1 (Session Cookies)** because:
- More secure (HttpOnly cookies)
- Already implemented in your backend
- Better for web applications
- Automatic CSRF protection

## Quick Fix for Current Issue

The immediate problem is `Bearer undefined`. In your frontend:

1. **Check if you're getting the token:**
```javascript
const token = await user.getIdToken();
console.log('Token:', token); // Should not be undefined
```

2. **Make sure you're setting it correctly:**
```javascript
// Wrong
headers: { 'Authorization': `Bearer ${undefined}` }

// Right
const token = await user.getIdToken();
if (token) {
  headers: { 'Authorization': `Bearer ${token}` }
}
```

3. **Or switch to session cookies (recommended):**
```javascript
// Instead of storing in localStorage, create session
await fetch('/api/auth/session', {
  method: 'POST',
  credentials: 'include',
  body: JSON.stringify({ idToken: token })
});
```
