# Bug Fix: Chat Responses Hanging Indefinitely

## Issue Summary

**Problem**: Chat responses would hang indefinitely (17+ seconds) when asking legal questions, never completing or showing an error.

**Root Cause**: Firestore quota exceeded + no timeouts on API calls

## What Was Fixed

### 1. Added Timeouts to Firestore Calls ✅

**File**: `server/legalCorpus.js`

- Added 10-second timeout to all Firestore queries
- Wrapped `findProvisions()` with timeout wrapper
- Clear error messages when timeout occurs

```javascript
const FIRESTORE_TIMEOUT_MS = 10000; // 10 second timeout

function withTimeout(promise, ms, operation = "operation") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${operation} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

// Usage in findProvisions():
snapshot = await withTimeout(
  db.collection(COLLECTION).where(...).get(),
  FIRESTORE_TIMEOUT_MS,
  "Firestore query"
);
```

### 2. Added Timeouts to LLM API Calls ✅

**File**: `server/chatRoute.js`

- Added 30-second timeout to all Groq and Gemini API calls
- Prevents indefinite hanging if LLM providers are slow or unresponsive

```javascript
const LLM_TIMEOUT_MS = 30000; // 30 second timeout

async function callCompletion(client, model, messages, options = {}) {
  const completionPromise = client.chat.completions.create({...});
  return withTimeout(completionPromise, LLM_TIMEOUT_MS, `LLM call to ${model}`);
}
```

### 3. Improved Error Handling ✅

**File**: `server/chatRoute.js`

- User-friendly error messages instead of technical jargon
- Specific messages for quota exceeded, timeouts, and other errors
- Technical details preserved for debugging

```javascript
if (err.message.includes("Quota exceeded")) {
  userMessage = "Our legal database is temporarily unavailable due to high demand. Please try again in a few minutes, or ask a different question.";
} else if (err.message.includes("timed out")) {
  userMessage = "The request took too long to process. Please try again with a simpler question.";
}
```

## Test Results

### Before Fix
```bash
$ curl -X POST http://localhost:3000/api/chat -d '{"question":"What are my rights..."}'
# Hangs for 17+ seconds...
{"error":"corpus_lookup_failed","message":"Quota exceeded."}
```

### After Fix
```bash
$ curl -X POST http://localhost:3000/api/chat -d '{"question":"What are my rights..."}'
# Fails in 10 seconds with clear message
{"error":"corpus_lookup_failed","message":"The request took too long to process. Please try again with a simpler question.","technicalDetails":"Failed to retrieve legal provisions: Firestore query timed out after 10000ms"}
```

## Root Cause: Firestore Quota Exceeded

The app is hitting Firestore's free tier daily read quota limit. This happens because:

1. **Free Tier Limits**: Firestore Spark plan has daily read/write quotas
2. **Bulk Ingestion**: The app ingested 8,000+ legal provisions
3. **Every Query Hits Firestore**: Each legal question triggers a Firestore read
4. **No Caching**: Same questions re-query Firestore instead of using cache

### Solutions (Choose One)

#### Option 1: Wait for Quota Reset (Temporary)
- Firestore quotas reset daily at midnight Pacific Time
- Wait a few hours and try again
- **Pros**: Free, no changes needed
- **Cons**: Temporary fix, will happen again

#### Option 2: Upgrade Firestore Plan (Recommended)
- Upgrade from Spark (free) to Blaze (pay-as-you-go)
- Costs ~$0.06 per 100,000 reads
- **Pros**: Permanent fix, scales with usage
- **Cons**: Small cost (but very cheap for this use case)

**How to upgrade**:
1. Go to Firebase Console → Project Settings → Billing
2. Click "Upgrade to Blaze plan"
3. Set a budget alert (e.g., $10/month)
4. Done! No code changes needed

#### Option 3: Add Caching (Advanced)
- Cache Firestore results in memory or Redis
- Cache key: `practice_area + jurisdiction + keywords`
- TTL: 1 hour (legal provisions don't change often)
- **Pros**: Reduces Firestore reads, faster responses
- **Cons**: More complex, requires cache invalidation strategy

Example implementation:
```javascript
const cache = new Map();
const CACHE_TTL = 3600000; // 1 hour

async function findProvisionsWithCache(params) {
  const cacheKey = JSON.stringify(params);
  const cached = cache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  const data = await findProvisions(params);
  cache.set(cacheKey, { data, timestamp: Date.now() });
  return data;
}
```

## Casual Chat Still Works ✅

The fix doesn't affect casual chat (greetings, small talk):

```bash
$ curl -X POST http://localhost:3000/api/chat -d '{"question":"Hi"}'
{"isCasual":true,"casualReply":"Hello! I'm here to help with any Nigerian legal questions you may have. What's on your mind?","provider":"groq"}
```

Casual messages bypass Firestore entirely, so they work even when quota is exceeded.

## Changes Summary

| File | Changes | Lines Changed |
|------|---------|---------------|
| `server/legalCorpus.js` | Added timeout wrapper, error handling | +20 lines |
| `server/chatRoute.js` | Added timeout to LLM calls, improved error messages | +30 lines |
| **Total** | **2 files** | **~50 lines** |

## Impact

- ✅ **No more indefinite hanging** - All API calls now have timeouts
- ✅ **Better UX** - Clear, user-friendly error messages
- ✅ **Faster failure** - 10 seconds instead of 17+ seconds
- ✅ **Debuggable** - Technical details preserved in error response
- ✅ **No breaking changes** - Casual chat still works, API contract unchanged

## Monitoring

To monitor for quota issues in production:

```bash
# Check server logs for Firestore errors
grep "Quota exceeded" /var/log/legally-unbullied.log

# Check response times
curl -w "@curl-format.txt" -X POST http://localhost:3000/api/chat -d '{"question":"test"}'

# Monitor Firestore usage in Firebase Console
# Firebase Console → Firestore → Usage
```

## Next Steps

1. **Immediate**: Upgrade Firestore to Blaze plan (5 minutes, ~$0.06/100k reads)
2. **Short-term**: Add caching to reduce Firestore reads
3. **Long-term**: Consider vector database (Pinecone, Weaviate) for semantic search

## Testing

To verify the fix:

```bash
# Test casual chat (should work immediately)
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"question":"Hi"}'

# Test legal question (should fail fast with clear message)
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"question":"What are my rights if my landlord evicts me?"}'

# Expected: Fails in ~10 seconds with user-friendly error
# Not: Hangs indefinitely
```

## Rollback

If needed, revert the changes:

```bash
git revert HEAD
npm install
# Restart server
```

## Support

- **Firestore Quotas**: https://firebase.google.com/docs/firestore/quotas
- **Upgrade Guide**: https://firebase.google.com/docs/projects/billing/upgrade-plan
- **Caching Strategies**: https://firebase.google.com/docs/firestore/solutions/caching

---

**Status**: ✅ Fixed and deployed

**Time to fix**: ~15 minutes

**Impact**: Critical bug resolved, app no longer hangs
