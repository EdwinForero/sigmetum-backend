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
7. **Docs**: add the variable to the table in docs/03 and run `npm run docs:check`, which cross-checks validateEnv.js, .env.example and docs/03. See docs/guias/mantenimiento.md.
8. **Rules and rationale**: [configuration and environment](../../../docs/guias/buenas-practicas-backend.md#8-configuración-y-entorno) (validate the value, not only that it exists) and [secrets](../../../docs/guias/seguridad.md#s1-ningún-secreto-en-el-repositorio-ni-en-los-logs). Optional variables go in `OPTIONAL_ENV` of scripts/quality-check.mjs with a reason.
