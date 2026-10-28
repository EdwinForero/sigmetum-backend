# M21 entrega 3: 404 con el envoltorio de la API: spec

Fecha: 2026-10-28 · Estado: cerrado

## Objetivo

Tras la entrega 2 (commit `8d69021`), una ruta inexistente (`GET /api/v1/no-existe`) o un método no definido en una ruta existente (`DELETE /api/v1/list-terms`) responde el `404` HTML por defecto de Express, sin el envoltorio `{ success: false, error }` que el resto de la API garantiza (`docs/integracion/para-frontend.md`, sección 2). Antes de la entrega 2 esos casos daban `401` con envoltorio por la causa de M21. Esta entrega cierra el estado transitorio aceptado por el usuario (decisión 1 de la spec de la entrega 2: las entregas 2 y 3 se despliegan seguidas).

Comportamiento actual (leído de `index.js`): `/healthcheck` se atiende primero; después `morgan`, `cors`, `express.json`, `compression`; después `authRoutes`, `dataRoutes`, `contentRoutes` bajo `API_PREFIX` y, al final, `errorHandler`. Nada responde a lo que ningún router resuelve, así que lo atiende el 404 por defecto de Express. `errorHandler` responde `{ success: false, error }` con `err.status` o `500`.

Es la entrega 3 de 3 (specs anteriores: `2026-10-28-m21-tokenauth-rutas-publicas-design.md` y `2026-10-28-m21-entrega2-apertura-rutas-publicas-design.md`).

## Criterios de aceptación

### De código

1. **Ruta inexistente bajo el prefijo.** Con y sin token (también con token inválido o caducado), `GET`, `POST`, `PUT`, `PATCH` y `DELETE` a una ruta que no existe bajo `API_PREFIX` (p. ej. `/api/v1/no-existe`) responden `404`, `Content-Type` JSON y cuerpo `{ success: false, error }` con `error` cadena.
2. **Método no definido en una ruta existente.** `DELETE /list-terms`, `POST /list-images` y `GET /upload` (ruta existente con otro método), con y sin token, responden lo mismo que el criterio 1: `404` con envoltorio. No se responde `405` ni cabecera `Allow` (propuesta, ver pregunta 2).
3. **Mensaje fijo.** `error` es el mismo texto fijo en inglés para todos los casos y no contiene la ruta, el método, la cadena de consulta, cabeceras ni ningún dato del cliente. Se comprueba con dos rutas inexistentes distintas (incluida una con caracteres especiales o `<script>` en la ruta) y que `error` es idéntico en ambas. Texto propuesto: `Not found` (pregunta 3).
4. **Orden en `index.js`.** El manejador 404 se monta después de `authRoutes`, `dataRoutes` y `contentRoutes` y antes de `errorHandler`. `errorHandler` sigue siendo el último y único manejador de errores. Se comprueba con la comprobación estática de `scripts/verificar-rutas.mjs` (criterio 8), que se adapta para reconocer este montaje sin perder la exigencia de `authRoutes, dataRoutes, contentRoutes` ni de `errorHandler` al final, y sigue fallando si el 404 se monta antes de un router o después de `errorHandler`.
5. **Alcance.** Propuesta (pregunta 1): el 404 es global, no limitado al prefijo. Una ruta fuera del prefijo que ningún manejador resuelve (`GET /`, `GET /otra`, `GET /api/v2/x`) también responde `404` con envoltorio. `GET /healthcheck` sigue respondiendo `200 ok` (texto) porque se atiende antes; no pasa por el manejador 404.
6. **CORS y preflight sin cambios.** Una petición `OPTIONS` a una ruta inexistente con origen permitido sigue respondiendo lo que responde hoy (el middleware `cors` la atiende antes de las rutas, `204` con las cabeceras CORS) **(por confirmar en la prueba)**. Las respuestas `404` de origen permitido llevan las cabeceras CORS habituales.
7. **Errores de CORS sin cambios.** Una petición con `Origin` no permitido sigue llegando a `errorHandler` (`Origin not allowed`) con el mismo estado y cuerpo que antes de la entrega; el manejador 404 no la intercepta. Se comprueba con la pila real de `index.js` o con una equivalente que incluya `cors`.
8. **Sin efecto en rutas existentes.** Las ocho rutas públicas y las nueve protegidas responden exactamente como tras la entrega 2: ningún criterio de `scripts/verificar-rutas.mjs` (1 a 8) cambia de resultado. Un fallo con `next(error)` (400, 401, 429, 500) sigue saliendo por `errorHandler`, no por el 404. El `400` de un JSON mal formado (`express.json`) sigue igual.
9. **Prueba repetible.** El criterio 9 de `scripts/verificar-rutas.mjs`, que hoy exige el `404` HTML transitorio, pasa a exigir el `404` con envoltorio para los casos de los criterios 1 a 3 y 5. Debe **fallar antes del cambio por el motivo correcto** (404 sin cuerpo JSON de envoltorio) y pasar después. La pila que monta el script incluye el manejador 404 en el mismo lugar que `index.js` (y `cors` si el criterio 6 o 7 se prueba ahí). La forma la decide `architect`.
10. `npm run lint`, `npm run quality` y `npm run docs:check` pasan; `npm run agentes:test` solo si se toca `plugins/`. `quality` no pierde ninguna red. No hay variables de entorno, dependencias ni permisos IAM nuevos; si `architect` concluye lo contrario, lo señala como veto o pregunta.
11. El manejador 404 no revela información interna y no registra el contenido de la petición más allá de lo que ya registra `morgan`.

### De documentación

1. `docs/04-api.md`: retirado el párrafo "Estado transitorio (hasta la entrega 3 de M21)"; documentado que una ruta inexistente o un método no definido responde `404` con `{ success: false, error }` (texto fijo), con o sin token.
2. `docs/05-modulos.md`: descrito el manejador 404 y su posición entre los routers y `errorHandler`.
3. `docs/01-arquitectura.md` y `docs/03-configuracion.md` (áreas de `index.js` según `.claude/flujo.json`): revisados; se tocan solo si describen el orden de middleware o rutas no encontradas.
4. `docs/07-estado-y-deuda-tecnica.md`: M21 resuelta por completo (entregas 1, 2 y 3) con la medición local antes y después de la entrega 3; "Prioridades sugeridas" (entrada 2) sin la entrega 3 pendiente; el resultado del GATE y de producción siguen como condiciones previas de despliegue de la entrega 2 (fuera de esta spec); fecha "actualizado" y métricas al día.
5. `docs/integracion/para-frontend.md`: eliminada la excepción del `404` HTML de la fila "Envoltorio único" (sección 2) y la nota de "diferencia visible transitoria" de F7; el `404` deja de figurar como "no usado hoy" si la política de códigos lo requiere; clasificación razonada (ver más abajo). F7 deja de depender de la condición (e).
6. `docs/guias/mantenimiento.md`: descripción del script de verificación al día (criterio 9 cambia de estado transitorio a 404 con envoltorio). `docs/guias/seguridad.md` solo si menciona el estado transitorio.
7. Aviso para PR en `docs/specs/*-aviso-pr.md` con el cambio de contrato (404 HTML a 404 JSON) y el recordatorio de despliegue seguido a la entrega 2.

## Clasificación del cambio según `para-frontend.md`

Propuesta: **compatible**. Razón: no renombra ni quita campos, no cambia el envoltorio de ninguna respuesta existente (lo restablece donde faltaba), no toca `fixedColumnOrder`, el formato de versión, el JWT ni CORS, y el código de estado (`404`) es el mismo que ya emite Express; solo cambia el cuerpo de HTML a JSON. No necesita `/api/v2`.

Comprobado en el código del frontend (28/10/2026): `src/services/api.js` hace `await response.json()` sin distinguir el estado, así que el `404` HTML actual lanzaría un error de parseo, y el `404` JSON cae en la rama `!json.success` con `error.status = 404`; `docs/integracion/para-backend.md` del frontend dice que no distingue 400, 401, 404 ni 500 y que no muestra el texto de `error`. No hay evidencia de que consuma el `404` como contrato. Pendiente de confirmar (según la guía, si no se sabe es incompatible): que ningún flujo del frontend (incluido `FileUpload.js`, que usa `fetch` propio) dependa del cuerpo HTML del `404`, y que la comprobación de salud de infra (`HealthCheckPath = "/"`, hoy `404` según `frontend/docs/integracion/para-infra.md` I6) solo mire el código de estado y no el cuerpo **(por confirmar con infra)**.

## Riesgos de seguridad

1. Un `404` que refleje la ruta, el método o la consulta introduciría reflejo de datos del cliente: por eso el mensaje es fijo (criterio 3).
2. Un manejador 404 montado antes de un router o de `errorHandler` taparía rutas o errores reales: cubierto por los criterios 4, 7 y 8.
3. No cambia qué rutas exigen token: las nueve protegidas siguen en `401` sin token y no se ven afectadas (criterio 8). Con el 404 global, una ruta futura protegida no declarada daría `404` y no `401`, lo que no es una pérdida de protección.
4. Hallazgo existente, fuera de alcance: el error de CORS (`Origin not allowed: <origin>`) pasa por `errorHandler` con estado `500` (la `Error` no trae `status`) y devuelve el origen enviado por el cliente en `error`. No se modifica aquí (criterio 7); se señala como posible hallazgo nuevo en `docs/07`.

## Fuera de alcance

- M2, M17 y cualquier otro ítem de `docs/07` ajeno al 404.
- Límites de peticiones de las rutas públicas (`/list-images`, `/get-image`, `/list-terms`, `/get-merged-data`).
- Las condiciones previas de despliegue de la entrega 2: GATE de `imageKey` contra dev sin imágenes reales (no concluyente), comportamiento de producción sin token y saltos de proxy (`trust proxy 1`).
- Responder `405` o la cabecera `Allow` (salvo que la pregunta 2 se decida al revés).
- Cambiar el estado o el mensaje del error de CORS (hallazgo del riesgo 4).
- Mapear `NoSuchKey` de S3 a `404` (B9), `/api/v2`, y tocar el frontend o `sigmetum-infra`.
- Decidir cómo se implementa (rol `architect`).

## Impacto en contratos externos

- `docs/integracion/para-frontend.md`: lo afecta de forma limitada. Rutas inexistentes y métodos no definidos pasan de `404` HTML a `404` JSON con envoltorio; mismo estado. Cierra la excepción transitoria de la sección 2 y la nota de F7. Propuesta: compatible (ver arriba), con dos puntos por confirmar.
- `docs/integracion/para-infra.md`: no hay variables de entorno ni IAM nuevos. Posible efecto solo si algún health check de infra (`/` hoy da `404`) valida el cuerpo y no el código **(por confirmar con infra)**.

## Decisiones del usuario (28/10/2026)

1. Alcance: el 404 con envoltorio es global, también fuera de `API_PREFIX`; `/healthcheck` queda a salvo porque se atiende antes.
2. Método no definido en una ruta existente: 404, como hoy; sin 405 ni cabecera `Allow`.
3. Mensaje fijo del 404: `Not found`, en el envoltorio `{ success: false, error }`, sin reflejar la ruta ni datos del cliente.
4. Error de CORS (`Origin not allowed: <origin>`, que sale por `errorHandler` con 500 y devuelve el origen del cliente): no se toca; se registra como hallazgo nuevo en `docs/07`.
5. Health check de Beanstalk (`HealthCheckPath = "/"` da 404 hoy según `para-infra.md`, I6): se mantiene la clasificación "compatible" y queda (por confirmar con infra) en el aviso para PR que solo mira el código y no el cuerpo; no bloquea.

## Preguntas abiertas

Ninguna.
