# M17 + M22: mensajes de error controlados y error de CORS: spec

Fecha: 2026-10-28 · Estado: cerrado

## Objetivo

Hoy `middleware/errorHandler.js` devuelve `err.message` al cliente para cualquier error no mapeado (última línea de `friendlyMessage`), también en producción y a visitantes anónimos en las rutas públicas (M17). Además, el rechazo de CORS sale como `500` con el origen del cliente reflejado en `error` (M22). La spec fija qué mensajes se conservan, cuáles pasan a genérico y qué estado y mensaje tiene el rechazo de CORS, sin cambiar el envoltorio `{ success: false, error }`.

## Comportamiento actual (contrastado con el código)

- `errorHandler`: `status = err.status || err.statusCode || (MulterError ? 400 : 500)`; el mensaje sale de `friendlyMessage`: mapeados `TokenExpiredError`, `JsonWebTokenError`, `MulterError` (`File upload error: ${err.message}`), códigos `NoSuchKey`, `NoSuchBucket`, `AccessDenied`, `NetworkingError`/`ECONNREFUSED`; el resto, `err.message || 'Internal server error'`.
- Registro: `console.error` con método, ruta y estado; en `NODE_ENV=local` con `err.stack`, en el resto con `err.message`.
- Errores con mensaje propio que llegan a `errorHandler` sin `status` (salen como 500 con su texto): `Excel conversion failed. The data is not valid.` (`routes/data.js`), `No files found in the specified folder.` y `Error getting signed URL` (`aws/awsS3connect.js`), y los de `exceljs`, el SDK de AWS, `nodemailer` y `bcrypt`. Ningún `throw new Error` del proyecto lleva `status`.
- Errores con `status` que no son de rutas: el `SyntaxError` de `express.json` (400, mensaje del parser) y otros del parser (por ejemplo 413 por tamaño, **por confirmar**).
- Respuestas 500 manuales que no pasan por `errorHandler`: `DELETE /delete-image` devuelve `result.error` y `DELETE /delete-term` devuelve `result.message`, ambos con el `error.message` del SDK (`aws/awsS3connect.js`).
- CORS (`index.js`): `callback(new Error('Origin not allowed: <origin>'))` sin `status` → `500` con el origen reflejado. `scripts/verificar-rutas.mjs` replica ese `cors` y hoy espera `500` y `^Origin not allowed` (criterio 9e) y `400` con envoltorio para JSON mal formado (criterio 9f).
- `docs/integracion/para-frontend.md` dice que `error` es "un texto en inglés, pensado para depurar, no para mostrar tal cual al usuario" y no documenta ningún mensaje concreto que el frontend compare. El `403` figura como "reservado". Comparación de textos por el frontend: **no comprobada** (ver pregunta 3).

## Criterios de aceptación

### De código

1. Un error sin `status` y sin mapear (por ejemplo `new Error('secreto interno')`, un error de `exceljs`, del SDK o de `bcrypt`) responde `500` `{ success: false, error: "Internal server error" }`; el texto original no aparece en el cuerpo.
2. Un error cuyo estado sea 5xx responde con el mensaje genérico `Internal server error`, salvo los mapeados del criterio 3 (decisión de la pregunta 1).
3. Se conservan sus mensajes: `TokenExpiredError` → `Token expired`, `JsonWebTokenError` → `Invalid token`, y los códigos `NoSuchKey`, `NoSuchBucket`, `AccessDenied`, `NetworkingError`/`ECONNREFUSED` con los textos actuales de `friendlyMessage` (propuesta; la pregunta 1 decide si los mapeados de almacenamiento se mantienen o pasan también a genérico).
4. Las respuestas 4xx que las rutas construyen con `res.status(400).json(...)` no cambian (no pasan por `errorHandler`). Un error 4xx de librería que llegue a `errorHandler` usa un texto fijo por tipo y no el `err.message` (pregunta 2).
5. El `SyntaxError` de `express.json` (JSON mal formado, `status` 400) responde `400` con envoltorio y el texto que fije la pregunta 2 (propuesta: `Invalid JSON`, sin el mensaje del parser). Nunca `Not found`.
6. `MulterError` sigue dando `400` con envoltorio; su texto lo fija la pregunta 4 (hoy `File upload error: ${err.message}`).
7. Una petición con `Origin` no permitido responde `403` `{ success: false, error: "Origin not allowed" }`, sin el origen en el cuerpo. Una petición sin `Origin` o con origen permitido no cambia (cabecera `Access-Control-Allow-Origin` presente con origen permitido).
8. El detalle sigue registrándose en consola con `[método] ruta → estado` más el mensaje (stack en `local`), de modo que el diagnóstico no se pierde y el cliente deja de recibirlo. Qué se registra del rechazo de CORS lo fija la pregunta 5.
9. Si la pregunta 5 incluye `DELETE /delete-image` y `DELETE /delete-term` en el alcance: cuando `result.success` es falso responden `500` con `Internal server error` en lugar de `result.error` / `result.message`, y el detalle se registra en consola.
10. `scripts/verificar-rutas.mjs` (parte de `npm run quality`) se actualiza: el caso 9e espera `403` `Origin not allowed` sin el origen; 9f sigue esperando `400` con envoltorio (y el texto que fije la pregunta 2); se añade un caso de error 500 sin mapear que comprueba el texto genérico y, si procede, uno de `delete-image`/`delete-term`. La réplica de `cors` del script coincide con la de `index.js`.
11. `npm run lint` y `npm run quality` pasan (y `npm run agentes:test` solo si se toca `plugins/`). No hay base de tests (M11): los criterios 1 a 9 se comprueban con `scripts/verificar-rutas.mjs` y observación en un arranque real con entorno ficticio **(por confirmar)**.

### De documentación

1. `docs/07-estado-y-deuda-tecnica.md`: M17 y M22 pasan a resueltas con fecha, y se actualizan sus menciones en M21 y en las prioridades (punto 5, "M15 y M17"); se actualiza la fecha "actualizado"; las cifras solo en la tabla de métricas.
2. `docs/guias/buenas-practicas-backend.md` (fila de mensaje de error controlado y lista de anti-patrones) y `docs/guias/seguridad.md` (S8, la fila de `errorHandler` y las menciones a M17) dejan de decir "No cumple" y describen la regla nueva, o la parte que quede abierta.
3. `docs/04-api.md` (sección de errores y la línea 88 que menciona M17/M22, **por confirmar el texto exacto**) y `docs/05-modulos.md` (`errorHandler`) reflejan los códigos y mensajes nuevos.
4. `docs/integracion/para-frontend.md`: la tabla de garantías dice que el `403` se usa para CORS rechazado y que los `500` llevan el mensaje fijo `Internal server error`, con la clasificación de cada cambio. `docs/integracion/para-infra.md` solo si cambia algo de `ALLOWED_ORIGIN` o de registros (se espera que no).
5. Los hallazgos relacionados que quedan abiertos (M15, límites de las rutas públicas) se mantienen; aviso para PR (`docs/specs/*-aviso-pr.md`) con la clasificación de contrato.

## Clasificación de contrato y riesgos

- Un `500` que antes llevaba `err.message` pasa a `Internal server error`: **compatible** según `para-frontend.md` (el texto es "para depurar" y el código no cambia), siempre que el frontend no compare textos **(por confirmar en el repositorio del frontend)**. Si lo comparara, sería incompatible y exigiría `/api/v2`.
- El `500` de CORS pasa a `403`: el navegador bloquea la respuesta por CORS de todos modos (la respuesta de error no lleva `Access-Control-Allow-Origin`), así que el frontend en un navegador no la ve; solo cambia lo que ven `curl`, herramientas y servidores. Se clasifica compatible, pero el `403` figura como "reservado" y hay que dejarlo escrito. Posible dependencia de monitorización por código 500 **(por confirmar con infra)**.
- Riesgos: perder diagnóstico (se mitiga con el registro, que conserva el mensaje real); `GET /list-images` con galería vacía (F3) sigue siendo 500 pero su texto `No files found in the specified folder.` deja de verse; los textos de validación 4xx de las rutas no cambian.

## Fuera de alcance

- M15 (validación del valor de las variables de entorno).
- Los límites de las rutas públicas y las condiciones previas de despliegue de las entregas 2 y 3 de M21 (GATE de `imageKey` no concluyente, producción sin token, saltos de proxy).
- Convertir los fallos que hoy son 500 (Excel inválido, objeto ausente en S3) en 4xx (B9, F3).
- Cambios en el frontend o en `sigmetum-infra`; se documentan y se avisan en la PR.
- Introducir una base de tests (M11).

## Impacto en contratos externos

- `docs/integracion/para-frontend.md`: lo afecta. Cambia el texto de los `500` y el estado del rechazo de CORS (500 a 403); tabla de garantías y sección de códigos a actualizar. No cambia el envoltorio ni los campos que lee el frontend. Compatible salvo que el frontend compare textos de error **(por confirmar)**.
- `docs/integracion/para-infra.md`: no lo afecta, salvo posible monitorización por código 500 de las peticiones CORS **(por confirmar)**; `ALLOWED_ORIGIN` no cambia.

## Decisiones del usuario (28/10/2026)

1. Errores 5xx de almacenamiento mapeados (`NoSuchKey`, `NoSuchBucket`, `AccessDenied`, `NetworkingError`/`ECONNREFUSED`): conservan su texto actual; el resto de 5xx devuelve `Internal server error`.
2. JSON mal formado (`SyntaxError` 400 de `express.json`): texto fijo `Invalid JSON`, mismo estado 400. Otros 4xx de librería (p. ej. 413): se revisan caso a caso (por confirmar).
3. `MulterError`: se mantiene `File upload error: ${err.message}` y el estado 400.
4. Alcance: entran `delete-image` y `delete-term` (dejan de reflejar `result.error`/`result.message` del SDK). El origen rechazado por CORS se registra con `console.warn` y no se devuelve al cliente: respuesta 403 con mensaje fijo `Origin not allowed` sin el origen.
5. Frontend (comprobado el 28/10/2026 en `src/services/api.js`): guarda `json.error` en `error.serverMessage` y el estado en `error.status`, pero ningún componente usa `serverMessage` ni compara texto ni estado; el cambio se clasifica compatible (el navegador además no deja ver la respuesta CORS rechazada).

## Preguntas abiertas

Ninguna.
