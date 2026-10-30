# M21 entrega 2: `tokenAuth` solo en las rutas protegidas (apertura de las rutas públicas): spec

Fecha: 2026-10-28 · Estado: cerrado

## Objetivo

Hoy `tokenAuth` se ejecuta también para `POST /send-email`, `GET /get-image`, `GET /list-images` y `GET /list-terms`, que `docs/04-api.md` marca públicas (🔓): sin token responden `401 No token provided`. Causa observada en el código: `routes/data.js` hace `router.use(protectedRouter)` sin ruta propia, se monta en `index.js` antes que `routes/content.js`, y `tokenAuth` intercepta peticiones que `data.js` no resuelve y que deberían llegar a `content.js`.

Esta entrega hace que `tokenAuth` se aplique **solo** a las nueve rutas protegidas (🔒) y que las ocho públicas respondan sin token. Es la entrega 2 de 3 de M21 (spec de la entrega 1: `docs/specs/2026-10-28-m21-tokenauth-rutas-publicas-design.md`, ya en el commit `fbf381f`). Las mitigaciones de la entrega 1 (límite 5 por 15 minutos y validación en `/send-email`, regla de `imageKey` en `/get-image` y `/delete-image`) son lo que permite abrir; esta entrega no las modifica.

Supuestos de partida (leídos del código el 28/10/2026):

- Clasificación (decisión 1 del usuario, vale para las tres entregas). Públicas (8): `POST /send-email`, `GET /list-images`, `GET /get-image`, `GET /list-terms`, `GET /list-files`, `GET /get-data/:path(*)`, `GET /get-merged-data`, `POST /log`. Protegidas (9): `GET /auth`, `POST /upload`, `POST /upload/confirm`, `POST /update-file`, `POST /delete-file`, `POST /upload-image`, `DELETE /delete-image`, `POST /upload-term`, `DELETE /delete-term`.
- `GET /auth` y `POST /log` están en `routes/auth.js` (montado primero); `GET /auth` ya lleva `tokenAuth` en la propia ruta, así que no depende del mecanismo roto.
- Las seis rutas protegidas de `data.js` y `content.js` hoy solo están protegidas porque cuelgan de un `protectedRouter` con `tokenAuth` que se monta sin ruta propia. Ese es el punto de riesgo de esta entrega: al cambiar el montaje, cada una puede quedar pública por accidente.
- Hoy `tokenAuth` actúa también sobre rutas inexistentes y métodos no definidos: devuelven `401` con envoltorio. Al quitarlo, caerán en el 404 por defecto de Express (HTML, sin envoltorio) hasta la entrega 3.

## Condiciones previas del PLAN (no de esta spec)

Antes de que el usuario apruebe el plan de `architect` deben constar, comunicadas por el usuario:

1. **GATE del criterio 6 de la entrega 1**: la regla de `imageKey` contrastada con el listado real de la galería (script `gate.cjs` del scratchpad; requiere `aws sso login` del usuario). Hoy **sin ejecutar** **(por confirmar)**. Si alguna clave real no pasa la regla, es un hallazgo que hay que decidir antes de abrir (ver pregunta 5).
2. **Lo que responde producción sin token** en `GET /list-terms` y `GET /list-images` (y, sin enviar correo, `POST /send-email` con cuerpo vacío: 400 si llega al manejador, 401 si no). Hoy **(por confirmar)**. Si da 200, el hallazgo es solo local y no hay urgencia; si da 401, la web pública (`/explorar`, galería, contacto) está rota y el orden de despliegue se decide con `para-frontend.md`.

## Criterios de aceptación

### De código

1. **Rutas públicas sin token.** Sin cabecera `Authorization`: `GET /list-images`, `GET /get-image?imageKey=<válida>`, `GET /list-terms`, `GET /list-files`, `GET /get-merged-data`, `GET /get-data/<clave>` y `POST /send-email` dejan de dar `401` y responden lo que decide su manejador: `200`, `400` (`/get-image` sin `imageKey` da `400 imageKey is required`; `imageKey` fuera de la regla, `400 imageKey is not valid`; `/send-email` inválido, `400`), `429` (`/send-email` por encima de 5 en 15 minutos) o `500` (fallo de S3 o SMTP), siempre con el envoltorio. `POST /log` responde como hoy.
2. **Rutas protegidas siguen protegidas.** Las nueve 🔒, **sin token**, responden `401 No token provided`; con token inválido, `401 Invalid token`; con token caducado, `401 Token expired`. Se prueba con las nueve, una por una, no por muestreo.
3. **Ninguna ruta que modifica estado queda abierta por accidente.** Para cada ruta `POST`, `PUT`, `PATCH` y `DELETE` que existe en la pila real (la que monta `index.js`): sin token, con token inválido y con token caducado, la respuesta es `401` y **ningún espía de S3 (escritura, borrado, subida) ni de SMTP registra una llamada**, salvo las dos excepciones de `PUBLIC_MUTATING_ROUTES` (`POST /log` y `POST /send-email`), que se comprueban con sus propias reglas (login y límite/validación). Para `POST /upload` y `POST /upload-image` (multipart) el rechazo ocurre sin procesar el fichero.
4. **Una ruta protegida no puede perder `tokenAuth` por olvido.** La comprobación repetible (criterio 5) lleva una tabla de clasificación de rutas (método, ruta, pública o protegida) y falla en dos casos: (a) una ruta declarada en el código que no está en la tabla (ruta nueva sin clasificar); (b) una ruta de la tabla marcada protegida que sin token no da `401`. Debe cubrir también las rutas `GET` protegidas (`GET /auth`), que la detección actual de `npm run quality` no vigila porque solo mira las que modifican estado.
5. **Comprobación repetible que recorre todas las rutas con y sin token** (token ausente, inválido, caducado y válido), con S3 y SMTP sustituidos y sin red ni credenciales reales, sobre la misma pila que `index.js` (`auth`, `data`, `content` bajo el mismo prefijo y `errorHandler` al final). Debe **fallar antes del cambio por el motivo correcto** (las cuatro rutas públicas dan `401` en vez de su respuesta) y pasar después. El script de la entrega 1 (`scripts/verificar-m21-entrega1.mjs`) asume el `401` sin token en su criterio 1 y deja de pasar por diseño: se adapta (su criterio 1 describe el comportamiento nuevo) sin perder los criterios 2 a 5 de la entrega 1, o se sustituye por uno que los incluya. La forma la decide `architect`.
6. **Las mitigaciones de la entrega 1 siguen vigentes y ahora también sin token.** Superadas las 5 peticiones en 15 minutos por IP, `POST /send-email` sin token responde `429` y no envía correo; un cuerpo inválido sin token responde `400` y no envía correo; un `imageKey` fuera de la regla sin token responde `400` sin llamar a S3.
7. **Authorization en rutas públicas.** Una ruta pública ignora la cabecera `Authorization`: con token inválido o caducado responde como sin token (decisión provisional, ver pregunta 2). Se prueba para las cuatro rutas que se abren.
8. **Rutas inexistentes y métodos no definidos.** Queda medido y documentado cómo responden mientras no llegue la entrega 3 (hoy `401`; tras el cambio, el 404 por defecto de Express salvo que se decida otra cosa, pregunta 3). Con y sin token. La comprobación lo registra para que la entrega 3 parta de un estado conocido.
9. **Preflight y CORS sin cambios.** Una petición `OPTIONS` a las rutas afectadas responde como antes (el middleware de CORS la atiende antes de las rutas) **(por confirmar)** en la comprobación.
10. `npm run lint`, `npm run quality` y `npm run docs:check` pasan. `quality` no pierde ninguna red: sigue fallando con una ruta mutante sin protección fuera de `PUBLIC_MUTATING_ROUTES`, y su detección estática no puede dar por protegida una ruta cuyo `tokenAuth` ya no se aplica de verdad (si el montaje cambia, la detección de `scripts/lib/repo.mjs` se adapta o el criterio 4 cubre el hueco). `PUBLIC_MUTATING_ROUTES` refleja el comportamiento real: la excepción de `POST /send-email` pasa a ser cierta también sin token y su texto en `scripts/quality-check.mjs` y la tabla de la regla S3 de `docs/guias/seguridad.md` lo dicen.
11. No hay variables de entorno, dependencias ni permisos IAM nuevos; si `architect` concluye lo contrario, lo señala como veto o pregunta.
12. M2 no cambia: `GET /get-data/:path(*)` sigue público, sin restricción de claves.

### De documentación

1. `docs/07-estado-y-deuda-tecnica.md`: M21 resuelta (entrega 2) con la medición local antes y después y el resultado de producción comunicado por el usuario; queda anotada la entrega 3 (404 con envoltorio) como pendiente; resultado del GATE; M4/M5 coherentes con él; M2 sigue abierta; "Prioridades sugeridas", fecha "actualizado" y métricas al día.
2. `docs/04-api.md`: retirado el aviso M21; las rutas 🔓 documentadas como alcanzables sin token y las 🔒 con su `401`; se anota la respuesta de rutas inexistentes mientras dure el estado transitorio.
3. `docs/05-modulos.md`: corregido el texto del patrón `router.use(protectedRouter)` y la nota de que `tokenAuth` corre antes que el limitador de `/send-email`.
4. `docs/integracion/para-frontend.md`: F6 cerrada (a la tabla de historial de `docs/07`) y F7 actualizada (los `400`/`429` ya son alcanzables sin token); sección 3 ("Límite de peticiones", "Códigos usados hoy") al día; clasificación razonada (ver más abajo).
5. `docs/integracion/para-infra.md`: el límite de `/send-email` ahora cuenta tráfico anónimo: se revisa lo de `trust proxy 1` y queda **(por confirmar con infra)** si no hay respuesta; "sin variables ni IAM nuevos".
6. `docs/guias/seguridad.md` (tabla de S3 y resumen de excepciones) y `docs/guias/mantenimiento.md` (script de verificación) al día con el cambio de comprobación.
7. Aviso para PR en `docs/specs/*-aviso-pr.md` con el cambio de contrato (sin token, de `401` a `200`/`400`/`429`/`500` en cuatro rutas) y el estado transitorio de las rutas inexistentes.

## Clasificación del cambio según `para-frontend.md`

Propuesta: **compatible, condicionada**; si una condición no se confirma, la guía manda tratarlo como incompatible.

- A favor: restablece el contrato ya documentado (`docs/04-api.md` y la documentación del frontend dicen que estas cuatro rutas se llaman sin `Authorization`). No renombra ni quita campos, no cambia el envoltorio, `fixedColumnOrder`, el formato de versión ni el JWT. Solo amplía el acceso; no necesita `/api/v2`. Backend primero es seguro: un frontend que ya llama sin token empieza a funcionar.
- Cautela: la sección 5 de `para-frontend.md` lista "una ruta, su método o si es pública o protegida" como motivo para actualizar `src/services/api.js`. Aquí no cambia lo que el frontend documenta, sino lo que el backend hace en realidad; aun así, no se da por bueno sin comprobarlo.
- Condiciones: (a) el frontend llama de verdad sin token a las cuatro rutas y no usa su `401` como señal (p. ej. redirigir al login); (b) el frontend maneja `400` y `429` de `/send-email` sin romperse (ya condición de la entrega 1); (c) resultado de producción comunicado (si es 200, el cambio observable en producción es nulo; si es 401, es corrección urgente); (d) el estado transitorio de las rutas inexistentes (no `401`, 404 sin envoltorio) no lo consume el frontend como contrato. Todas **(por confirmar)** contra el código del frontend y la respuesta del usuario.
- Diferencia visible fuera de las cuatro rutas: rutas inexistentes y métodos no definidos pasan de `401` con envoltorio a 404 por defecto de Express (HTML) hasta la entrega 3; contradice la garantía "toda respuesta es envoltorio" de la sección 2 durante ese intervalo.

## Riesgos de seguridad

1. **Rutas protegidas que pasan a públicas por accidente** (el riesgo principal). Hoy las seis rutas protegidas de `data.js` y `content.js` están protegidas solo por el montaje del `protectedRouter`; cambiar el montaje sin una prueba que recorra las nueve podría dejar `POST /upload`, `/update-file`, `/delete-file`, `/upload-image`, `DELETE /delete-image`, `/upload-term` o `DELETE /delete-term` sin token. Cubierto por los criterios 2, 3 y 4. Las nueve siguen protegidas por decisión del usuario.
2. **Nuevas rutas o rutas movidas sin `tokenAuth`**: la red estática de `quality` solo vigila rutas que modifican estado y confía en el nombre `protectedRouter`; un `GET` protegido sin `tokenAuth` no se detecta. Cubierto por el criterio 4.
3. **`POST /send-email` y el limitador con tráfico anónimo**: el cupo de 5 por 15 minutos por IP ahora lo consume cualquiera; con `trust proxy 1` mal calculado, todos comparten una IP (se bloquea a todos) o ninguna se limita. Ver pregunta 1 y para-infra. Es el único camino público que cuesta (cuota de Gmail).
4. **Superficie pública nueva sin límite**: `GET /list-images`, `GET /get-image` y `GET /list-terms` llaman a S3 sin token y sin límite de peticiones (en `docs/guias/seguridad.md` ya figura "valorar `/get-merged-data`"). Fuera de alcance, pero queda anotado en M21/`docs/07` como riesgo residual al abrir.
5. **`GET /get-image` firma URLs de cualquier clave bajo el prefijo de la galería** que cumpla la regla, sin exigir que exista en el listado (decisión 4 de la entrega 1); ahora sin token. Riesgo residual aceptado por decisión; se documenta.
6. **M2 sin cambio**: `GET /get-data/:path(*)` ya es público y lee cualquier clave. No se cierra aquí (depende de D1/F1).
7. Los errores de las rutas ahora públicas no revelan detalles internos: se mantienen `errorHandler` y los mensajes genéricos.

## Fuera de alcance

- La entrega 3: 404 con envoltorio para rutas inexistentes y métodos no definidos.
- M2 (cerrar o restringir `GET /get-data`), y el resto de M4/M5 (`/upload-image`: MIME y claves; `/update-file` y `/delete-file`).
- Límites de peticiones nuevos en `/list-images`, `/get-image`, `/list-terms`, `/get-merged-data`.
- Cambiar la regla de `imageKey`, el límite o la validación de `/send-email` (entrega 1).
- Crear `/api/v2`, cambiar la forma de las respuestas existentes o tocar el frontend y `sigmetum-infra`.
- Decidir cómo se implementa (rol `architect`).

## Impacto en contratos externos

- `docs/integracion/para-frontend.md`: lo afecta. Cuatro rutas sin token pasan de `401` a `200`/`400`/`429`/`500`; las nueve protegidas no cambian; rutas inexistentes cambian de `401` a 404 por defecto durante el intervalo hasta la entrega 3. Cierra F6 y actualiza F7. Propuesta: compatible, condicionada (ver arriba).
- `docs/integracion/para-infra.md`: no hay variables de entorno ni IAM nuevos. Afecta indirectamente: el límite por IP de `/send-email` pasa a contar tráfico anónimo, lo que depende de `trust proxy 1` tras ALB y nginx **(por confirmar con infra)**.

## Decisiones del usuario (28/10/2026)

1. Rutas inexistentes hasta la entrega 3: se acepta el intervalo con el 404 HTML por defecto de Express y las entregas 2 y 3 se hacen y despliegan seguidas.
2. Rutas públicas con cabecera `Authorization` inválida o caducada: se ignora la cabecera y responden con normalidad (coherente con las públicas de `data.js`).
3. Limitador de `/send-email`: se mantiene 5 por 15 minutos contando todas las peticiones, también las anónimas y los 400; la IP real tras `trust proxy 1` sigue (por confirmar con infra).
4. Si el GATE rechaza claves reales de la galería: la entrega 2 espera; se corrige la regla de `imageKey` en otro ciclo y no se abre `GET /get-image` hasta entonces. La regla no se relaja en silencio.
5. El resultado de producción sin token en `list-terms`, `list-images` y `send-email` y el GATE siguen siendo condiciones previas del PLAN, no de esta spec.

## Preguntas abiertas

Ninguna.
