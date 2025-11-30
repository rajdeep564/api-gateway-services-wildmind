# FRONTEND_ORIGIN vs ALLOWED_ORIGINS - Purpose & Usage

## Overview

You now have **2 environment variables** for managing CORS origins. Here's why and how to use them:

## 1. `FRONTEND_ORIGIN` (Primary Frontend Origins)

**Purpose**: Defines your **main frontend application URLs** - the primary domains where your app runs.

**Supports**: Single URL OR comma-separated list of URLs

**Example**:
```env
# Single URL
FRONTEND_ORIGIN=https://www.wildmindai.com

# OR Multiple URLs (comma-separated)
FRONTEND_ORIGIN=https://www.wildmindai.com,https://wildmindai.com,https://studio.wildmindai.com
```

**Use Case**: 
- Your main production frontend domains
- Subdomains of your primary domain
- Preview/staging environments

**Behavior**:
- Automatically allows subdomains (e.g., `www.wildmindai.com` allows `app.wildmindai.com`)
- Used for cookie domain matching
- Primary CORS origin list

## 2. `ALLOWED_ORIGINS` (Additional Allowed Origins)

**Purpose**: Defines **additional external origins** that need API access - third-party domains, partner sites, or special cases.

**Supports**: Comma-separated list of URLs

**Example**:
```env
ALLOWED_ORIGINS=https://partner-site.com,https://admin.example.com,https://custom-domain.net
```

**Use Case**:
- Third-party integrations
- Partner websites
- Admin panels on different domains
- External services that need API access

**Behavior**:
- Exact match only (no automatic subdomain matching)
- Additional to `FRONTEND_ORIGIN`
- Used for special cases

## Why Two Separate Variables?

### **Separation of Concerns**

1. **`FRONTEND_ORIGIN`** = **Your domains** (what you own/control)
   - Main application
   - Subdomains
   - Preview environments
   - Automatically handles subdomain matching

2. **`ALLOWED_ORIGINS`** = **External domains** (third-party/partners)
   - Partner integrations
   - External admin panels
   - Special cases
   - Exact match only

### **Benefits**

✅ **Clear Intent**: Easy to see which are your domains vs external
✅ **Flexible**: Can use one or both
✅ **Maintainable**: Separate configuration for different use cases
✅ **Security**: Clear distinction between your domains and external access

## How They Work Together

Both are **combined** in the CORS configuration:

```typescript
const allowedOrigins = [
  ...productionDomains,
  ...devDomains,
  ...env.frontendOrigins,    // Your main frontend URLs
  ...env.allowedOrigins       // Additional external origins
].filter(Boolean);
```

## Recommended Setup

### **Production Example**:

```env
# Your main frontend domains (comma-separated)
FRONTEND_ORIGIN=https://www.wildmindai.com,https://wildmindai.com,https://studio.wildmindai.com

# Additional external origins (if needed)
ALLOWED_ORIGINS=https://partner-site.com,https://admin.example.com
```

### **Development Example**:

```env
# Your local development URLs
FRONTEND_ORIGIN=http://localhost:3000,http://localhost:3001

# Usually empty in dev
ALLOWED_ORIGINS=
```

## Summary

| Variable | Purpose | Supports Multiple? | Auto Subdomains? |
|----------|---------|-------------------|------------------|
| `FRONTEND_ORIGIN` | Your main frontend domains | ✅ Yes (comma-separated) | ✅ Yes |
| `ALLOWED_ORIGINS` | External/third-party origins | ✅ Yes (comma-separated) | ❌ No (exact match) |

**Best Practice**: Use `FRONTEND_ORIGIN` for your domains, and `ALLOWED_ORIGINS` only when you need to allow external/third-party domains.

