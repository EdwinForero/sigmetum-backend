---
name: env-var-change
description: Checklist for adding, renaming, or removing environment variables. Use whenever config/validateEnv.js, .env, or .env.example need to change.
---

# Environment Variable Change Checklist

1. **Register it**: add the new variable name to the `required` array in config/validateEnv.js (or `requiredLocal` if it's only needed when `NODE_ENV === 'local'`, e.g. AWS_PROFILE).
2. **Fail fast**: confirm validateEnv() is still called early in index.js startup so a missing var crashes at boot, not mid-request.
3. **Document it**: add the variable (with a placeholder, not a real value) to `.env.example`.
4. **No leftover references**: if renaming/removing a variable, grep the codebase for old `process.env.OLD_NAME` usages and update them all.
5. **Scope correctly**: don't add a var to `required` if it's genuinely optional — use a default fallback in code instead, so validateEnv doesn't over-constrain local/dev setups.
6. **Infra sync**: if this variable also needs to exist in deployed environments (e.g. sigmetum-infra), note that it must be added there too — validateEnv.js only checks local process.env at runtime.
