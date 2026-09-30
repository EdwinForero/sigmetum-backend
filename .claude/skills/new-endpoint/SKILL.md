---
name: new-endpoint
description: Checklist for adding a new route/endpoint in this Express backend. Use when creating or modifying a route handler in routes/.
---

# New Endpoint Checklist

Follow this project's existing conventions (see routes/content.js, routes/auth.js, routes/data.js) when adding a route.

1. **Router placement**: public routes go on the base `router`; anything requiring auth goes on a `protectedRouter` that uses `tokenAuth` middleware (see functions/tokenAuthentication.js).
2. **Input validation**: validate required body/query params explicitly and return `res.status(400).json({ success: false, error: '...' })` before touching S3, auth, or the filesystem.
3. **Error handling**: wrap logic in try/catch and call `next(error)` — do not res.json the error directly. Let middleware/errorHandler.js format it.
4. **Response shape**: always respond with `{ success: true, data: ... }` or `{ success: false, error: ... }`, matching existing routes.
5. **File uploads**: use the existing `multer({ storage: multer.memoryStorage() })` instance pattern, not disk storage.
6. **New env vars**: if the endpoint needs a new environment variable, add it to config/validateEnv.js's `required` (or `requiredLocal`) array and to `.env.example`.
7. **S3 paths**: reuse or extend config/s3Paths.js constants instead of hardcoding path strings.
8. **Rate limiting / CORS**: confirm the route is covered by existing express-rate-limit and cors setup in index.js — don't bypass it.
9. **Mount the router**: confirm the router is required and mounted in index.js if this is a new route file.
