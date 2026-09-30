---
name: security-pre-merge
description: Pre-merge security checklist for this backend before merging to master. Use before opening/merging a PR that touches auth, routes, middleware, or dependencies.
---

# Security Pre-Merge Checklist

1. **Secrets**: `git diff` for hardcoded credentials, tokens, or keys — everything sensitive must come from `process.env` and be listed in config/validateEnv.js.
2. **.env hygiene**: confirm `.env` is not staged; `.env.example` reflects any new variable names (without real values).
3. **Auth coverage**: any new protected route uses `tokenAuth` (functions/tokenAuthentication.js) — don't rely on the client to gate access.
4. **CORS**: confirm `ALLOWED_ORIGIN` is respected and no route response adds permissive CORS headers of its own.
5. **Rate limiting**: sensitive routes (auth, upload, delete) are covered by express-rate-limit in index.js.
6. **Dependencies**: run `npm audit` and review any new dependency for maintenance status and necessity.
7. **Error responses**: verify middleware/errorHandler.js's `isDev` gate is not being bypassed — stack traces must not leak in production responses.
8. **Input sanitization**: user-supplied strings used in S3 keys or file names are sanitized (see the `sanitizedTitle` pattern in routes/content.js) to prevent path traversal or key injection.
9. **Password/token handling**: bcrypt is used for password hashing and jsonwebtoken for tokens — no custom crypto, no plaintext comparisons.
