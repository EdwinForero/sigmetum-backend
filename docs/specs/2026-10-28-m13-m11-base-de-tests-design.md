# Base de tests de la API (M13 y M11): spec

Fecha: 2026-10-28 · Estado: cerrado

## Objetivo

Hoy `index.js` valida el entorno, construye la app y escucha en el puerto en un solo paso, y no exporta la app (M13); además no hay tests ni framework (M11), y `npm test` es el placeholder de `npm init`. Se busca poder probar la API sin abrir un puerto, sin cargar el entorno real y sin llamar a S3, con una suite ejecutable con `npm test` y enganchada a la CI. La verificación actual por script (`scripts/verificar-rutas.mjs`, criterios 1 a 15) migra entera a esa suite y el script se retira. No cambia el comportamiento de la API ni su contrato con el frontend.

Decisiones del usuario incorporadas: (1) se prueban funciones puras y la app importada con S3 simulado, no el flujo completo upload/confirm/delete; (2) migración total y retirada del script; (3) `node:test` más `supertest`; (4) M13 resuelto y M11 parcial; (5) tests en `tests/` con nombre `*.test.js`.

## Criterios de aceptación

### De código

1. Separación (M13): `app.js` construye y exporta la app; importarlo no abre ningún puerto ni invoca `validateEnv`. `index.js` conserva `dotenv`, los manejadores `uncaughtException` y `unhandledRejection`, `validateEnv()` y `listen`. Se comprueba con una prueba que importa la app y termina sin quedarse colgada.
2. `npm start` sigue arrancando en `PORT` (8000 por defecto) tras validar el entorno, y `GET /healthcheck` responde 200 con cuerpo `ok` (Beanstalk).
3. Comportamiento idéntico: mismas rutas bajo `API_PREFIX`, mismo orden de middleware (healthcheck, morgan, CORS con 403 sin reflejar origen, json, compression, rutas, 404 con envoltorio, errorHandler) y `trust proxy` en 1. Se demuestra con los casos migrados (criterio 7) pasando sobre la app real, no sobre una réplica.
4. `npm test` ejecuta la suite real (`node:test` y `supertest`), sale con 0 si pasa y distinto de 0 si falla, y no necesita `.env`, credenciales de AWS ni red. Los archivos viven en `tests/` y se llaman `*.test.js`.
5. Ninguna prueba llama a S3 ni a SMTP reales; ambos quedan simulados. Se comprueba ejecutando la suite sin credenciales ni red.
6. Áreas cubiertas (decisión 1): `convertExcelToJson`, `getNextVersion`, `formatFileName`, validadores (`validateProvincia`, `validateDataKey` y los de `/send-email` e `imageKey`) y la app importada (autenticación, CORS, 404, errorHandler y rutas) con S3 simulado.
7. Migración de `scripts/verificar-rutas.mjs`: cada uno de los criterios 1 a 15 tiene su equivalente en la suite, con los mismos casos y los mismos resultados esperados (por pasos si hace falta). La spec exige una tabla de trazabilidad criterio -> test, que se entrega con el plan y se completa al cerrar, y que no quede ningún caso sin equivalente. Los casos del script, hoy:

   | Criterio del script | Contenido que debe conservarse |
   |---|---|
   | 1 | Las ocho rutas públicas responden sin token (nunca 401) |
   | 2 a 5 | Límite y validación de `POST /send-email` anónimo; validación de `imageKey` en GET y DELETE |
   | 6 | Las nueve rutas protegidas dan 401 sin token, con token inválido y caducado; `/upload` y `/upload-image` con multipart; mayúsculas y barra final |
   | 7 | Todas las rutas mutantes dan 401 y no llaman a S3 ni SMTP (salvo `POST /log` y `POST /send-email`) |
   | 8 | Estructura: clasificación contra la pila real, `tokenAuth` primer manejador de cada ruta protegida y ausente en las públicas, sin `use(tokenAuth)` a nivel de router |
   | 9 | Authorization inválido en rutas abiertas; 404 con envoltorio fijo sin 405; `/healthcheck` y OPTIONS; Origin no permitido 403; JSON mal formado 400 |
   | 10 | Errores controlados y CORS (M17, M22): 500 genérico, 5xx explícito, mapeados, 4xx de librería, MulterError, 413, delete-* sin reflejar el SDK, origen fuera de las respuestas |
   | 11 | Fecha UTC única (A1), también con `TZ=Pacific/Kiritimati` |
   | 12 | Validación del nombre de provincia (A4) |
   | 13 | `POST /upload` con Excel real en memoria: provincia válida e inválida |
   | 14 | Claves del cliente en upload/confirm, update-file y delete-file (formato, NFC, sin tocar S3) |
   | 15 | Prefijo con barra en listados sobre `aws/awsS3connect.js` real con `S3Client.send` parcheado |

8. Se conserva la comprobación de rutas protegidas sin `tokenAuth`: debe seguir existiendo en `npm run quality` (con `scripts/lib/repo.mjs` y `scripts/quality-check.mjs`) y en la suite (criterio 8 del script). No se pierde ninguna de las dos barreras; la pregunta de qué parte vive dónde la resuelve el `architect` sin reducir cobertura.
9. El criterio 8 pasa de leer `index.js` de forma estática y usar una réplica de CORS a ejercitar la `app.js` real; se mantiene la detección de ausencia de los elementos que hoy detectan los marcadores. La suite repite el criterio 11 con `TZ=Pacific/Kiritimati`.
10. Retirada del script: `scripts/verificar-rutas.mjs` y el script `verificar:rutas` de `package.json` se eliminan, y `scripts/quality-check.mjs` deja de invocarlo (el paso de rutas de `quality` queda sustituido sin perder la comprobación del criterio 8). No quedan referencias huérfanas en el código ni en los comentarios (p. ej. `scripts/lib/repo.mjs`).
11. Dependencia nueva `supertest` (devDependency). Justificación: peticiones HTTP contra la app Express sin abrir puerto fijo ni escribir un cliente a mano, y es la herramienta que M13 ya nombra. Debe pasar `npm audit` sin avisos nuevos y sin `npm audit fix --force`; si arrastra avisos, se informa y no se oculta. `node:test` ya viene con Node 22.
12. `npm run lint`, `npm run quality` y `npm run docs:check` pasan; `npm run agentes:test` solo si se toca `plugins/`. `--max-warnings` solo baja si baja el número real.
13. CI (`.github/workflows/ci.yml`, área crítica): el job `verify` ejecuta `npm test` y bloquea el despliegue si falla; `tests/*` se excluye del zip de despliegue; `app.js` va en el zip porque `index.js` lo necesita. Se comprueba leyendo el workflow y listando el contenido del zip generado con la misma orden **(por confirmar en CI real)**.
14. Umbral y riesgo: el umbral acordado es separar `app.js`/`index.js` + áreas del punto 6 + CI con `npm test`. La migración total del script lo amplía: el alcance real incluye ya el flujo de `POST /upload`, `update-file`, `delete-file` y los listados (criterios 11 a 15), pero solo con espías y a nivel de ruta, no el flujo de datos completo contra una S3 simulada con estado. Por eso M11 sigue parcial. Riesgo: el script supera con holgura las mil líneas y es un cambio grande; el criterio de aceptación es "mismos casos, mismos resultados", entregable por pasos (un criterio o grupo por paso, con el script vivo hasta que el último tenga equivalente) y verificable con la tabla del criterio 7.

### De documentación

1. `docs/07-estado-y-deuda-tecnica.md`: M13 resuelto con fecha y commit; M11 parcial con lo que falta anotado (flujo upload/confirm/delete con S3 simulado con estado y el resto de módulos); métrica "Archivos de test" con la cifra real; métricas de dependencias (una devDependency más) y de scripts actualizadas; fecha "actualizado" de hoy; las menciones a `scripts/verificar-rutas.mjs` en el texto histórico de M-/A- se actualizan para que no apunten a un script inexistente. M14 sin cambios de estado.
2. `docs/01-arquitectura.md`, `docs/04-api.md`, `docs/05-modulos.md` y `docs/03-configuracion.md` (áreas de `index.js`) reflejan la separación entre construir la app y escuchar. `docs/03-configuracion.md` sustituye la fila de `npm run verificar:rutas` por `npm test` y ajusta la de `quality`.
3. `docs/02-tecnologias.md`: `supertest` y `node:test` como herramientas de test, con su versión y su justificación (dependencias de desarrollo).
4. `docs/guias/mantenimiento.md` (sección del script de verificación de rutas M21 y definición de terminado) y `docs/guias/buenas-practicas-backend.md`, `docs/guias/seguridad.md`: cómo escribir y ejecutar tests, que `npm test` forma parte de terminado, y que la comprobación de rutas protegidas se hace ahora en la suite y en `quality`.
5. `CLAUDE.md`: el comando `npm test` deja de ser el placeholder (y se retira `verificar:rutas` si se cita); el comentario de `.github/workflows/ci.yml` se actualiza. `docs:check` valida que los comandos citados existen en `package.json`.
6. `docs:check` cuenta "Archivos de test" con los archivos `*.test.js`/`*.spec.js` (y `.mjs`/`.cjs`) fuera de `plugins/`; con `tests/*.test.js` se cuentan sin ajustar el script. Se comprueba que la cifra de docs/07 coincide.
7. Aviso de PR (`docs/specs/*-aviso-pr.md`): `.github/**` es área crítica (CI) y `package.json` también; el aviso recoge el cambio de CI, la exclusión de `tests/*` del zip y la dependencia nueva.

## Fuera de alcance

- Cambiar rutas, formato de respuestas, columnas del Excel, nombres de versión, JWT, CORS o variables de entorno.
- El flujo completo upload/confirm/delete contra una S3 simulada con estado (queda anotado en M11).
- M14 (mover lógica de negocio fuera de `aws/`), salvo lo mínimo que la separación exija.
- Tests de contrato con el frontend (siguiente paso de docs/07 tras M11).
- Pruebas de `plugins/` (siguen con `npm run agentes:test`).
- Cambios en `sigmetum-frontend` o `sigmetum-infra`.

## Impacto en contratos externos

- `docs/integracion/para-frontend.md`: no lo afecta si se cumple el criterio de código 3; rutas, respuestas, CORS y JWT no cambian.
- `docs/integracion/para-infra.md`: no cambian variables ni permisos IAM. Beanstalk sigue arrancando con `npm start` sobre `index.js` y usando `/healthcheck`. Cambia el workflow de CI (área crítica): paso `npm test` y exclusión de `tests/*` del zip; `app.js` debe estar en el zip. `docs/integracion/para-infra.md` cita el despliegue desde la CI: se revisa si hay que reflejar la exclusión.

## Preguntas abiertas

Ninguna.
