# Aviso para PR: B7 y M24 (a, b), limpieza de estructura y controles

Fecha: 30/10/2026

Integración: sin impacto — cambio interno (mover `tokenAuth` a `middleware/`, fusionar el login en `routes/auth.js`, retirar el rastro de `uploads/` y mejorar dos controles de `scripts/`); no cambia rutas, métodos, códigos ni cuerpos de respuesta, JWT, CORS, variables de entorno ni permisos IAM.

## Qué cambia

- `functions/tokenAuthentication.js` pasa a `middleware/tokenAuthentication.js` (contenido idéntico) y `functions/userAuthentication.js` se fusiona en `routes/auth.js`. `tests/capas-importaciones.test.js` vigila también `middleware/`.
- Se quita el rastro de `uploads/` de `.gitignore`, `eslint.config.js` y `scripts/lib/repo.mjs`.
- `docs:check` falla si `index.js` declara rutas (M24 a); `quality-check` mata el árbol de procesos si la suite agota el tiempo máximo (M24 b).
- `.claude/flujo.json`: claves renombradas de `docsPorArea` y `areasContrato`.

## Contrato

Sin cambio de contrato con el frontend (`docs/guias/mantenimiento.md`, sección 6: no afecta).

## Qué debe hacer el otro repositorio

- Frontend: nada.
- `sigmetum-infra`: nada. **(por confirmar)** con infra que ningún despliegue (Dockerfile, `.ebextensions`, scripts) espera la carpeta `uploads/`; en este repositorio no existe ni se cita.

## Pendiente

- M24 (d), `npm audit` de la CI, queda como decisión pendiente con infra; `.github/workflows/ci.yml` no cambia. M24 (c), `MIN_TESTS`, también pendiente.
