# Aviso para PR: M21 entrega 2, apertura de las rutas públicas (28/10/2026)

Spec: [2026-10-28-m21-entrega2-apertura-rutas-publicas-design.md](2026-10-28-m21-entrega2-apertura-rutas-publicas-design.md) · Plan: [2026-10-28-m21-entrega2-apertura-rutas-publicas-plan.md](2026-10-28-m21-entrega2-apertura-rutas-publicas-plan.md). Es la entrega 2 de 3 de M21. **Cambia el contrato con el frontend.**

## Antes de desplegar (obligatorio, aún sin hacer)

- **Saltos de proxy (`trust proxy`)**: antes de desplegar, confirmar con infra cuántos saltos de proxy hay delante de Express; si hay un salto más de los que cuenta `trust proxy 1`, un solo cliente podría agotar el cupo de 5 por 15 min de `/send-email` para todos. `index.js` comenta "ALB → nginx → Express" y [para-infra](../integracion/para-infra.md) describe "nginx (loopback) → Express". **(por confirmar)**. Si exige cambiar `trust proxy`, es un cambio fuera de esta entrega (vuelve a `architect`).
- **GATE de `imageKey`**: contrastar cada `fileName` de `GET /list-images` con `isValidImageKey` (script `gate.cjs` del scratchpad, tras `aws sso login`). Reintentado el 28/10/2026: sigue `Token is expired`, **(por confirmar)**. Si alguna clave real no pasa, no se abre `GET /get-image` y la regla no se relaja en silencio (decisión 4 del usuario).
- **Producción sin token**: qué responden hoy `GET /list-terms`, `GET /list-images` y `POST /send-email` con cuerpo vacío (400 si llega al manejador, 401 si no). **(por confirmar)**. Con 401 es una corrección urgente y el orden de despliegue se decide con [para-frontend](../integracion/para-frontend.md).

El usuario aprobó el plan sin que constaran estas tres comprobaciones; por eso son condición de despliegue, no de implementación.

## Qué cambia (contrato)

- `POST /send-email`, `GET /list-images`, `GET /get-image` y `GET /list-terms` dejan de responder `401` sin token y pasan a responder `200`, `400`, `429` o `500`, con el envoltorio de siempre. Ignoran la cabecera `Authorization` (inválida o caducada responde igual que sin token).
- Las nueve rutas protegidas (`GET /auth`, `POST /upload`, `POST /upload/confirm`, `POST /update-file`, `POST /delete-file`, `POST /upload-image`, `DELETE /delete-image`, `POST /upload-term`, `DELETE /delete-term`) no cambian: `401` sin token (`No token provided`), con token inválido (`Invalid token`) y caducado (`Token expired`). `tokenAuth` es ahora el primer manejador de cada una (antes de `multer` en las subidas) y desaparecen los `protectedRouter`.
- **Estado transitorio**: rutas inexistentes (`GET /no-existe`) y métodos no definidos (`DELETE /list-terms`) pasan de `401` con envoltorio al `404` HTML por defecto de Express (sin `{ success, error }`), con o sin token, hasta la entrega 3 (404 con envoltorio).
- Código: `routes/data.js`, `routes/content.js`, `scripts/lib/repo.mjs`, `scripts/quality-check.mjs`, `scripts/verificar-rutas.mjs` (nuevo, sustituye a `verificar-m21-entrega1.mjs`) y el script `verificar:rutas` en `package.json`. `index.js` no cambia (CORS y preflight igual).
- Sin variables de entorno, dependencias ni permisos IAM nuevos.

## Frontend

Clasificación: **compatible, condicionada** (F6 cerrada, F7 actualizada en [para-frontend](../integracion/para-frontend.md)); si una condición no se confirma, es incompatible. Restablece el contrato ya documentado (esas cuatro rutas se llaman sin token); no cambia el envoltorio, `fixedColumnOrder`, el JWT ni el prefijo. Despliegue: **backend primero**, y las entregas 2 y 3 **seguidas**. A confirmar en el código del frontend **(por confirmar)**:

1. Llama sin token a las cuatro rutas y no usa su `401` como señal (por ejemplo, redirigir al login).
2. `ContactForm` maneja el `400` y el `429` de `/send-email` sin romperse.
3. No consume como contrato el `404` de las rutas inexistentes.

## Infraestructura

Ver la línea obligatoria de arriba. [para-infra](../integracion/para-infra.md): el límite de `/send-email` (5 por 15 minutos por IP, en memoria) cuenta ahora el tráfico anónimo y los `400`; sin variables de entorno ni IAM nuevos.

## Para el usuario

- Riesgo residual aceptado: `GET /list-images`, `GET /get-image`, `GET /list-terms` y `GET /get-merged-data` llaman a S3 sin token y sin límite de peticiones; `GET /get-image` firma cualquier clave bajo `gallery/` que cumpla la regla, exista o no. M2 sigue abierta.
- `errorHandler` devuelve `err.message` a anónimos en las rutas ya públicas (M17, preexistente, fuera de alcance).
- Una ejecución de ESLint dentro de `quality` falló de forma aislada con un volcado nativo de Node en Windows; dos reejecuciones pasaron. Intermitente **(por confirmar)**.
- Alcance de `verificar-rutas.mjs`: monta los routers reales con S3 y nodemailer simulados, pero no carga el `index.js` real (`cors`, `compression` y `morgan` no se ejercitan; `index.js` se lee estáticamente); no es una verificación de la pila de producción. Falla si un criterio no registra casos, y `quality` falla con una declaración de ruta partida en varias líneas (`unparsedRouteLines()`). Observación menor sin resolver: el timeout con `shell: true` en Windows puede dejar vivo el proceso `node` hijo.
- Verificación hecha: `node scripts/verificar-rutas.mjs` (nueve criterios en verde; antes de tocar `routes/` fallaban 108 casos), `npm run lint` (0 errores, 5 avisos), `npm run quality` y `npm run docs:check`.
