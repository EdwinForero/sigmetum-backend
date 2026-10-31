# Aviso para PR: M12/D7, saltos de proxy configurables (`TRUST_PROXY_HOPS`)

Fecha: 2026-10-30 · Spec: [design](2026-10-30-m12-trust-proxy-configurable-design.md) · Plan: [plan](2026-10-30-m12-trust-proxy-configurable-plan.md)

## Qué cambia

`app.js` ya no fija `trust proxy` en 1: toma el valor de la variable de entorno opcional `TRUST_PROXY_HOPS` (`config/trustProxy.js`). Sin ella el valor sigue siendo 1, así que el despliegue actual no cambia. De ese valor sale `req.ip`, que es la clave del cupo de los limitadores de login (10 por 15 min) y de `POST /send-email` (5 por 15 min).

- Valores admitidos: entero de 1 a 5 en todo entorno estricto; `0` solo con `NODE_ENV` exactamente `local` o `test`.
- Inválidos (vacía, `true`, `false`, listas, rangos, IP, negativos, decimales, mayores de 5, espacios, ceros a la izquierda): en un entorno estricto el backend **no arranca**; en `local` y `test` avisa con `console.warn` (nombre y regla, nunca el valor) y usa 1.
- Hueco heredado de M15: con `NODE_ENV=test` en un despliegue se admitiría `0` y valores inválidos con solo un aviso.

## Qué debe hacer infra (`sigmetum-infra`)

1. **Variable nueva opcional** `TRUST_PROXY_HOPS` en `app_env_vars` de Terraform, por entorno. Compatible: sin ella todo sigue igual. Sin permisos IAM ni endpoints nuevos.
2. **Medir los saltos reales** (guía en la sección 6 de `docs/integracion/para-infra.md`, **por confirmar con infra**): desde un cliente de IP conocida, sin `X-Forwarded-For` propio, observar la cabecera y el socket que llegan a Express. Valor = entradas de `X-Forwarded-For` que añaden los proxies más uno; comprobar que con ese valor `req.ip` es la IP del cliente. No se fija ningún valor por entorno en este cambio.
3. **Confirmar la cadena de proxies**: el comentario anterior de `app.js` decía ALB → nginx → Express, `para-infra.md` decía nginx → Express y la spec supone CloudFront → nginx → Express en dev y preprod. Pregunta abierta.
4. Hacerlo **antes de la entrega 2 de M21** (ruta pública `/send-email`): M12 y esa condición previa siguen abiertas hasta entonces.

Riesgo de un valor erróneo: mayor que el real, el cliente puede esquivar el límite con `X-Forwarded-For` (con más saltos que entradas, `req.ip` es lo que controla el cliente); menor, todos comparten el cupo.

## Integración

- **Infraestructura**: afectada como se indica arriba (variable nueva opcional y compatible).
- **Frontend (`sigmetum-frontend`)**: sin cambios de contrato (rutas, respuestas, JWT y CORS intactos). F13, F14 y F15 de `docs/integracion/para-frontend.md` pasan a resueltos en el frontend (commit `8db9d56`); F16 no se toca. `frontend:D7` sigue abierto en el frontend: el backend ya permite fijar los saltos y la fiabilidad del 429 depende del valor que fije infra.

## Para quien revisa

- Código: `config/trustProxy.js` (nuevo), `app.js`, `config/validateEnv.js` (reutiliza `LENIENT_ENVS` y añade la regla), `.env.example` (`TRUST_PROXY_HOPS=1`), `scripts/quality-check.mjs` (`OPTIONAL_ENV` y `MIN_TESTS` a 1447). `app.js`, `config/validateEnv.js` y `.env.example` son áreas de contrato: revisada la sección 6 de `docs/guias/mantenimiento.md`.
- Pruebas: `tests/trust-proxy.test.js` (nuevo), `tests/validate-env.test.js` y `tests/helpers/entorno.js`.
- Documentos: `docs/03-configuracion.md`, `docs/05-modulos.md`, `docs/integracion/para-infra.md`, `docs/integracion/para-frontend.md`, `docs/guias/seguridad.md`, `docs/guias/mantenimiento.md`, `docs/07-estado-y-deuda-tecnica.md`.
