# M21 `tokenAuth` en rutas públicas de `content.js`: spec (entrega 1 de 3: mitigaciones)

Fecha: 2026-10-28 · Estado: cerrado

## Objetivo

Contexto del problema (M21): `tokenAuth` se ejecuta también para peticiones que `data.js` no resuelve y que deberían llegar a `content.js`. Por eso `POST /send-email`, `GET /get-image`, `GET /list-images` y `GET /list-terms`, marcadas públicas (🔓) en `docs/04-api.md`, responden `401 No token provided` sin token, y una ruta inexistente responde 401 en vez de 404 (verificado en local el 28/10/2026; en producción por confirmar, ver condición previa).

La solución completa se reparte en **tres ciclos separados, cada uno con su commit, siempre mitigaciones antes de abrir**. **Este ciclo es SOLO la entrega 1**: las mitigaciones, **sin abrir todavía ninguna ruta**.

La entrega 1 debe lograr que:

1. `POST /send-email` tenga un límite de peticiones y una validación de formato y longitud de sus cuatro campos (absorbe M3).
2. `GET /get-image` y `DELETE /delete-image` validen `imageKey` contra una lista de permitidos reutilizable antes de construir la clave de S3 (absorbe la parte de M4/M5 que afecta a esas dos rutas).
3. Las mitigaciones funcionen donde hoy son alcanzables: con token válido, porque `tokenAuth` aún intercepta. Ninguna ruta cambia de pública a protegida ni al revés.

Comportamiento actual relevante (leído del código): `index.js` monta `authRoutes`, `dataRoutes` y `contentRoutes` en ese orden bajo el mismo prefijo; cada router hace `router.use(protectedRouter)` sin ruta propia, y `protectedRouter` empieza con `tokenAuth`. `routes/auth.js` ya usa `express-rate-limit` (`loginLimiter`) para el login; `GET /get-image` y `DELETE /delete-image` construyen la clave como `${GALLERY_PATH}/${imageKey}` en `aws/awsS3connect.js` con texto del cliente.

## Decisiones del usuario (28/10/2026)

1. **Clasificación de rutas** (vale para las tres entregas): públicas las que dicen `docs/04-api.md` y el frontend: `POST /send-email`, `GET /list-images`, `GET /get-image`, `GET /list-terms`, `GET /list-files`, `GET /get-data`, `GET /get-merged-data` y `POST /log`. Protegidas las nueve 🔒: `GET /auth`, `POST /upload`, `POST /upload/confirm`, `POST /update-file`, `POST /delete-file`, `POST /upload-image`, `DELETE /delete-image`, `POST /upload-term`, `DELETE /delete-term`.
2. **Límite de `POST /send-email`**: 5 peticiones por 15 minutos por IP; al superarlo, `429` con el envoltorio `{ success: false, error }`; mismo mecanismo que `loginLimiter` (`express-rate-limit`). Que la IP sea la correcta tras `trust proxy 1` en producción: **(por confirmar con infra)**.
3. **Reglas de `POST /send-email`**: los cuatro campos son cadenas recortadas no vacías; correo con formato básico y máximo 254 caracteres; nombre máx. 100; asunto máx. 150; mensaje máx. 2000; sin saltos de línea en nombre, correo ni asunto. Contrastar con los límites reales de `ContactForm`: **(por confirmar)**.
4. **`imageKey`** (corregida el 28/10/2026 tras la segunda opinión sobre el plan): `upload-image` solo sustituye espacios del título y no valida el nombre, así que la regla admite letras y números Unicode (`\p{L}`, `\p{N}`, tildes y ñ incluidas) y los signos `. _ - ( ) +` dentro de cada segmento, con `/` simple como separador. Se rechaza: `..`, un segmento que empieza por `.`, `/` inicial, `//`, barra invertida, espacios y caracteres de control, más de 200 caracteres y cualquier extensión que no sea de imagen (jpg, jpeg, png, gif, webp, sin distinguir mayúsculas). No se exige que la clave exista en el listado de la galería. Lo que el listado real de S3 no cumpla se trata como hallazgo, sin relajar más la regla (por confirmar).
5. **`DELETE /delete-image`**: se aplica la misma validación reutilizable.
6. **Reparto en tres ciclos separados**, cada uno con su commit: entrega 1 = mitigaciones (este ciclo); entrega 2 = apertura de las rutas públicas de `content.js`; entrega 3 = 404 con envoltorio.
7. **Producción**: el usuario comprobará el estado real y lo comunicará antes de aprobar el plan de la entrega 2 (y, si es posible, de esta). No se da por hecho ningún resultado.
8. **M2 y el resto de M4/M5 siguen fuera de alcance.**

## Condición previa

Antes de aprobar el plan de arquitectura de esta entrega, o a más tardar el de la entrega 2, debe constar, comunicado por el usuario, el comportamiento real en producción de `GET /list-terms` y `GET /list-images` sin token (y, sin enviar correo, de `POST /send-email` con cuerpo vacío: 400 si llega al manejador, 401 si no). Efecto sobre el alcance:

- Si producción devuelve 200: el hallazgo es solo local; el impacto para el frontend es nulo y las entregas 2 y 3 no son urgentes.
- Si producción devuelve 401: la web pública (`/explorar`, galería, contacto) está rota ahora; es urgente completar las entregas 1 y 2 y el orden de despliegue se decide con `para-frontend.md`.

Hasta entonces, esa condición queda **(por confirmar)**. La entrega 1 no depende de ella para su alcance.

## Hechos de partida

- El frontend documenta (`sigmetum-frontend/docs/03-api.md`, `integracion/para-backend.md`) que `POST /send-email`, `GET /list-images`, `GET /get-image` y `GET /list-terms` se llaman **sin** `Authorization` (`ContactForm`, `VegetationGallery`, `App.fetchTerms` en `/explorar`).
- Rutas protegidas en el código (🔒): las nueve de la decisión 1.
- Rutas públicas en `data.js` (sin cambio): `GET /list-files`, `GET /get-data/:path(*)`, `GET /get-merged-data`.

## Criterios de aceptación (entrega 1)

### De código

1. **Sin abrir rutas**: sin cabecera `Authorization`, `POST /send-email`, `GET /get-image`, `GET /list-images` y `GET /list-terms` siguen respondiendo `401 No token provided` en esta entrega, igual que antes; las nueve rutas 🔒 siguen en `401` sin token (`Invalid token` con token inválido, `Token expired` con caducado). Las rutas públicas de `data.js` y `POST /log` responden como antes.
2. `POST /send-email`, con token válido: superado el límite de 5 peticiones por 15 minutos desde la misma IP, responde `429` con `{ success: false, error }` (mensaje genérico, sin detalles internos) y no envía correo; dentro del límite, el comportamiento es el actual.
3. `POST /send-email`, con token válido: un cuerpo con campo ausente, de tipo no cadena, vacío tras recortar, con correo de formato inválido, por encima de la longitud máxima de la decisión 3, o con salto de línea en nombre, correo o asunto, responde `400` con `{ success: false, error }` y no envía correo. Un cuerpo válido sigue enviándose.
4. `GET /get-image`, con token válido: un `imageKey` que no cumple la lista de permitidos (decisión 4) responde `400` sin llamar a S3; con `..`, `/` inicial, `//`, caracteres fuera de la lista, más de 200 caracteres o extensión no permitida nunca llega a `getPresignedUrlFromS3`. Sin `imageKey` mantiene `400 imageKey is required`. Un `imageKey` válido sigue devolviendo la URL prefirmada.
5. `DELETE /delete-image`, con token válido: mismo rechazo `400` sin llamar a S3 con las mismas entradas inválidas; un `imageKey` válido sigue borrando como hoy. La regla es una única validación compartida por ambas rutas.
6. Las claves que devuelve hoy `GET /list-images` (formato real de la galería) pasan la validación; si alguna no pasara, se señala como hallazgo en la entrega (no se relaja la regla en silencio).
7. Las pruebas de los criterios 2 a 5 fallan antes del cambio por el motivo correcto (sin límite, sin validación) y pasan después. Como hoy no hay base de tests (M11), puede ser un script repetible con entorno ficticio y S3/SMTP sustituidos o sin red; la forma la decide `architect`. Debe demostrar que la mitigación funciona **con token**, que es donde es alcanzable.
8. `npm run lint`, `npm run quality` y `npm run docs:check` pasan. `quality` no pierde ninguna red (en particular la detección de rutas que modifican estado fuera de protegidas); su excepción `PUBLIC_MUTATING_ROUTES` para `POST /send-email` no cambia en esta entrega.
9. No se añaden variables de entorno ni dependencias nuevas (`express-rate-limit` ya está en el proyecto); si `architect` concluye lo contrario, lo señala como veto o pregunta.

### De documentación

1. `docs/07-estado-y-deuda-tecnica.md`: M3 se marca resuelta (límite y validación en `/send-email`) con fecha; M4/M5 se actualizan indicando que `GET /get-image` y `DELETE /delete-image` ya validan `imageKey` y qué sigue pendiente (`/upload-image`: MIME y claves); **M21 sigue abierta**, con nota de que la entrega 1 ya está hecha y quedan las entregas 2 y 3; "Prioridades sugeridas", fecha "actualizado" y métricas (si cambian) al día.
2. `docs/04-api.md`: se documentan, en `/send-email`, el `429` y los `400` nuevos; en `/get-image` y `/delete-image`, el `400` por `imageKey` no permitido, aclarando que hoy solo son alcanzables con token (el aviso M21 se mantiene hasta la entrega 2).
3. `docs/integracion/para-frontend.md`: se anotan el `429` y los nuevos `400` como cambio de comportamiento y se razona su clasificación (ver abajo). F6 no se cierra en esta entrega.
4. `docs/integracion/para-infra.md`: se revisa el límite por IP tras proxy (`trust proxy 1`) y se deja como **(por confirmar con infra)**; si nada más cambia, "sin variables ni IAM nuevos".
5. `docs/guias/seguridad.md`: se actualiza si la guía describe M3/M4 como abiertos.
6. `docs/05-modulos.md`: solo si cambia la descripción de los módulos afectados (límite y validación); el texto sobre el patrón `router.use(protectedRouter)` y M21 no se toca todavía.
7. Aviso para PR en `docs/specs/*-aviso-pr.md` con el cambio de contrato de la entrega 1 (400/429 nuevos).

## Clasificación del cambio según para-frontend.md (entrega 1)

La entrega 1 solo añade `400` y `429` a rutas que hoy solo son alcanzables con token (`POST /send-email`, `GET /get-image`, `DELETE /delete-image`); sin token siguen dando 401, exactamente como hoy. No renombra ni quita campos, no cambia el envoltorio, `fixedColumnOrder`, el formato de versión ni el JWT.

Propuesta: **compatible**, sujeta a que:

- (a) Las entradas que el frontend envía hoy superen las reglas nuevas: campos y longitudes reales de `ContactForm` frente a la decisión 3, y claves de `list-images` frente a la decisión 4. **Por confirmar** contra el código del frontend.
- (b) El frontend trate `429` y `400` de `/send-email` mostrando un error sin romperse. **Por confirmar** (como las rutas aún dan 401 sin token, el formulario de contacto público no llega a estos códigos hasta la entrega 2, pero debe estar listo antes de abrirla).
- (c) El panel con token que usa `DELETE /delete-image` no envíe hoy claves que la regla rechace. **Por confirmar**.

Si (a), (b) o (c) no se confirman, la guía exige tratarlo como incompatible (si no sabes si es compatible, es incompatible).

## Riesgos de seguridad

1. `POST /send-email` pública (entrega 2) sin estas mitigaciones permitiría inundar el buzón y agotar la cuota de Gmail: por eso las mitigaciones van primero. Riesgo residual: un límite por IP es evadible con muchas IP y, si la IP se toma mal tras el proxy, o bloquea a todos los usuarios (todos comparten la IP del proxy) o no limita a nadie (IP falsificable por cabecera). **(por confirmar con infra)**.
2. `imageKey` con texto del cliente: la lista de permitidos cubre el recorrido de rutas y la firma o borrado de objetos fuera del patrón. Riesgo residual aceptado por decisión: al no exigir que la clave exista en el listado, se pueden firmar objetos bajo el prefijo de galería no listados.
3. Los mensajes de error de validación y del límite no deben revelar detalles internos ni permitir enumeración.
4. M2 (`GET /get-data` público lee cualquier clave) no cambia; no se cierra aquí (depende de D1).
5. Los rechazos deben ocurrir antes de cualquier llamada a S3 o a SMTP.

## Fuera de alcance

- Abrir las rutas públicas de `content.js` y arreglar `tokenAuth` (entrega 2) y el 404 con envoltorio (entrega 3).
- Cerrar o restringir `GET /get-data` (M2, depende de D1).
- Validar el MIME y las claves de `POST /upload-image` (resto de M4/M5).
- Exigir que `imageKey` exista en el listado de la galería.
- Crear `/api/v2`, cambiar la forma de las respuestas existentes o tocar el frontend y `sigmetum-infra`.
- Protección anti-bot avanzada (captcha, verificación de dominio, colas, tope global por cuota de Gmail): solo límite por IP y validación mínima.
- Decidir cómo se implementa (eso es del rol `architect`).

## Entregas siguientes (ciclos separados, no forman parte de este)

Orden obligatorio: la entrega 1 se commitea antes de empezar la 2; nunca se abren rutas sin las mitigaciones.

**Entrega 2: apertura de las rutas públicas de `content.js` (arreglo de M21).** Condición previa de producción: constar el comportamiento real de `GET /list-terms`, `GET /list-images` y `POST /send-email` sin token (ver arriba); si producción da 401, es urgente y el orden de despliegue se decide con `para-frontend.md`. Criterios resumidos:

- `tokenAuth` solo en las rutas protegidas: `POST /send-email`, `GET /get-image`, `GET /list-images` y `GET /list-terms` dejan de dar 401 sin token (`/get-image` sin `imageKey` da `400 imageKey is required`; `/send-email` inválido, `400`; superado el límite, `429`).
- Las nueve rutas 🔒 siguen en 401 sin token; las públicas de `data.js` y `POST /log` sin cambios.
- Comprobación repetible que recorre todas las rutas con y sin token y que falla antes del cambio por el motivo correcto.
- `quality` conserva sus redes; `PUBLIC_MUTATING_ROUTES` refleja el comportamiento real.
- Documentación: M21 resuelta en `docs/07` con medición local y de producción, F6 cerrada en `para-frontend.md`, retirada del aviso M21 en `docs/04-api.md` y corrección en `docs/05-modulos.md`; clasificación compatible (restablece el contrato documentado), a confirmar que el frontend no usa el 401 como señal.

**Entrega 3: 404 con envoltorio.** Una ruta inexistente, con y sin token, responde `404` con `{ success: false, error }` (sin `err.message` interno ni la ruta reflejada), producido por un manejador anterior a `errorHandler`; la prueba repetible lo cubre; se actualizan `docs/04-api.md` y `docs/05-modulos.md`. Que una ruta existente con método no definido se trate como inexistente queda por decidir en ese ciclo.

## Impacto en contratos externos

- `docs/integracion/para-frontend.md`: lo afecta de forma limitada. La entrega 1 añade `400` (formato y longitud en `/send-email`, `imageKey` no permitido en `/get-image` y `/delete-image`) y `429` en `/send-email`, solo alcanzables hoy con token. Sin token no cambia nada. Propuesta: compatible, a confirmar (ver arriba). Se actualiza el documento con estas anotaciones; F6 se cierra en la entrega 2.
- `docs/integracion/para-infra.md`: no se prevén variables de entorno nuevas ni cambios de IAM; el límite por IP depende de cómo llega la IP del cliente tras el proxy (`trust proxy 1`), **(por confirmar con infra)**. Si los valores del límite se hicieran configurables por variable de entorno, sí habría impacto (decisión de arquitectura; no se pide aquí).

## Preguntas abiertas

Ninguna. Los puntos pendientes están marcados **(por confirmar)** en el cuerpo: IP correcta tras `trust proxy 1` (infra), límites reales de `ContactForm`, extensiones de imagen de la galería y compatibilidad con el frontend; los verifica `architect` o `tester-documentador` contra el código y los documentos de integración.
