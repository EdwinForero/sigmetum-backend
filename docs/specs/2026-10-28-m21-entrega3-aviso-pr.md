# Aviso para PR: M21 entrega 3, 404 con envoltorio (28/10/2026)

Spec: [2026-10-28-m21-entrega3-404-envoltorio-design.md](2026-10-28-m21-entrega3-404-envoltorio-design.md) · Plan: [2026-10-28-m21-entrega3-404-envoltorio-plan.md](2026-10-28-m21-entrega3-404-envoltorio-plan.md). Es la entrega 3 de 3 de M21. **Cambia el contrato con el frontend** (el cuerpo del 404, no su estado).

## Antes de desplegar (obligatorio; siguen pendientes las condiciones de la entrega 2)

Ver [el aviso de la entrega 2](2026-10-28-m21-entrega2-aviso-pr.md). Esta entrega **se despliega seguida de la 2**: entre ambas, las rutas inexistentes dan un `404` HTML.

- **GATE de `imageKey`**: ejecutado el 28/10/2026 contra el bucket de dev `sigmetum-app-assets-dev` (eu-west-3): sin imágenes reales, solo el marcador de carpeta con clave vacía. **NO concluyente**; repetirlo con datos reales (en producción) antes de abrir `GET /get-image`.
- **Producción sin token**: qué responden `GET /list-terms`, `GET /list-images` y `POST /send-email` con cuerpo vacío. **(por confirmar)**.
- **Saltos de proxy** delante de Express (`trust proxy 1`) y su efecto en el límite de `/send-email`. **(por confirmar con infra)**.

## Qué cambia (contrato)

- Una ruta que ningún router resuelve (`GET /api/v1/no-existe`, también fuera del prefijo: `GET /`, `GET /otra`) o un método no definido en una ruta existente (`DELETE /api/v1/list-terms`, `HEAD` incluido) pasa del `404` HTML de Express al `404` con `{ "success": false, "error": "Not found" }` (`Content-Type` JSON), con o sin token. Mismo estado; solo cambia el cuerpo.
- Texto fijo: no refleja ruta, método ni consulta. Sin `405` ni cabecera `Allow`.
- Sin cambios: `/healthcheck` (200 `ok`), el preflight `OPTIONS` con CORS (204), las respuestas de las rutas existentes y el `400` de un JSON mal formado.
- Código: `middleware/notFound.js` (nuevo), `index.js` (`require` y `app.use(notFound)` tras los tres routers y antes de `errorHandler`) y `scripts/verificar-rutas.mjs` (criterios 8 y 9, réplica de `/healthcheck` y `cors` en la pila).
- Sin variables de entorno, dependencias ni permisos IAM nuevos.

## Frontend

Clasificación: **compatible**, sin `/api/v2` (no renombra ni quita campos, no toca `fixedColumnOrder`, JWT, CORS ni la versión). Backend primero. Sigue **(por confirmar)** en el código del frontend que ningún flujo (incluido `FileUpload.js`, que usa `fetch` propio) dependa del cuerpo HTML del `404`. Ver F7 en [para-frontend](../integracion/para-frontend.md). Si no se confirma, es incompatible.

## Infraestructura

[para-infra](../integracion/para-infra.md): sin variables ni IAM nuevos. El `HealthCheckPath` en `sigmetum-infra` es `/healthcheck` (verificado en `modules/beanstalk/main.tf`) y no cambia; el `para-infra.md` del frontend aún cita `/` (I6), documento desactualizado. Si algún entorno desplegado apuntara a `/`, seguiría viendo `404`, ahora en JSON: que solo mire el código **(por confirmar con infra)**. No bloquea.

## Para el usuario

- **Hallazgo nuevo M22 (no tocado)**: el error de CORS (`Origin not allowed: <origin>`) sale por `errorHandler` con `500` y devuelve el origen del cliente en `error`. Corrección propuesta fuera de alcance: `403` o mensaje fijo, revisando el contrato CORS con el frontend.
- `morgan('combined')` sigue registrando método, URL y consulta de cada petición, también de los 404; `notFound` no escribe nada por su cuenta.
- Discrepancia de documentación corregida: `docs/01` y `docs/03` decían región `eu-west-1` y bucket `sigmetum-app-dev`; el real es `eu-west-3` y `sigmetum-app-assets-dev` (según `sigmetum-infra` y `para-infra.md`). `.env.example` (I1) y el `.env` local siguen con `eu-west-1`/`sigmetum-dev` o `sigmetum-app-dev`: los cambia el usuario.
- Nota A5: con la galería sin imágenes y solo el marcador de carpeta, `getPresignedUrlsFromS3Folder` devuelve el marcador como una imagen con clave vacía **(por confirmar)**.
- Verificación hecha: `node scripts/verificar-rutas.mjs` (rojo previsto antes de `notFound.js`: criterio 8 52/53 y criterio 9 13/50; después 54/54 y 50/50; la prueba negativa del orden hace fallar el criterio 8 tres veces), arranque real con entorno ficticio, `npm run lint` (0 errores, 5 avisos) y `npm run quality`.
