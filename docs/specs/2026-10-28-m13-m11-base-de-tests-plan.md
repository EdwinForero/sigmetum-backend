# Base de tests de la API (M13 y M11): plan

Fecha: 2026-10-28 · Estado: cerrado · Spec: `docs/specs/2026-10-28-m13-m11-base-de-tests-design.md`

Crítico: sí (dependencias: `supertest`; CI: `ci.yml`). Segunda opinión sobre el plan: recibida (sin críticos, seis cambios importantes y menores) e incorporada en esta versión. El paso 13 edita `.claude/flujo.json` y el usuario lo aprobó de forma explícita.

## Hechos comprobados en el código

- Express 4.22.3. `Layer` pone `this.name = fn.name || '<anonymous>'` (`node_modules/express/lib/router/layer.js:42`).
- Capas de nivel app: `query`, `expressInit`, `corsMiddleware`, `jsonParser`, `compression`, `logger` (morgan) y `router` (los tres routers). El healthcheck es una flecha inline (`<anonymous>`); `notFound` y `errorHandler` son constantes con nombre inferido.
- Pila exacta esperada (12 capas): `query`, `expressInit`, `<anonymous>` (`/healthcheck`), `logger`, `corsMiddleware`, `jsonParser`, `compression`, `router`, `router`, `router`, `notFound`, `errorHandler`.
- Los limitadores en memoria viven en `routes/auth.js` (`loginLimiter`) y `routes/content.js` (`sendEmailLimiter`); `routes/data.js` no tiene.
- `scripts/verificar-rutas.mjs` contiene literales Unicode invisibles en las líneas 328 a 330 (U+2028, U+2029) y 375 (U+0301); U+0085 ya va escapado.
- `supertest` no está instalado; versión 7.3.1 y «0 vulnerabilidades» son datos del revisor (por confirmar en el paso 2).

## Decisiones de diseño

1. **Orden sin perder cobertura.** El script sigue vivo y verde hasta el paso 11. En el paso 1 solo se toca para leer `app.js` en vez de `index.js` y para añadir un modo `--lista` que imprime `criterio|nombre del caso` por cada `record()` (línea base caso a caso). Descartado migrar y borrar por criterio (ventanas con cobertura parcial).
2. **Simular S3 y SMTP.** Espías de `aws/awsS3connect.js` y de `nodemailer` inyectados en `require.cache` antes de cargar `app.js`. `node --test` ejecuta cada archivo en un proceso propio. `appNueva()` borra de la caché `routes/auth.js`, `routes/content.js` y `app.js` y requiere `app.js` de nuevo; cada petición usa una IP única con `X-Forwarded-For` (`nextIp`). `app.js` no llama a `validateEnv` ni a `dotenv`; `index.js` ejecuta `validateEnv()` antes de `require('./app')` (porque `aws/awsS3connect.js` lee `AWS_REGION` al cargarse). Entorno ficticio en `tests/helpers/entorno.js`, requerido el primero. Contadores globales y `spyTotal()` se reinician por test. Descartado `mock.module` (experimental en Node 22).
3. **Control de «criterio vacío».** Dentro de los tests, cada bucle que genera subtests va precedido de un test que exige `longitud > 0` (la tabla de rutas, mutantes > 0, listas de casos). En `quality`, el paso 7 ejecuta la suite entera con `node --test --test-reporter=tap "tests/**/*.test.js"` y falla si: el código de salida no es 0; `# fail` no es 0; `# skipped` o `# todo` no son 0; `# tests` es menor que `MIN_TESTS` (constante igual al total final de la tabla de trazabilidad); faltan `tests/estructura-rutas.test.js` o `tests/rutas-protegidas.test.js`; o no hay líneas de resumen. `spawnSync` solo en `quality-check.mjs`. El formato del resumen TAP de Node 22 es (por confirmar); el developer ajusta la expresión al resultado real. La CI ejecuta `npm test` y `quality` (la suite corre dos veces).
4. **Rutas sin `tokenAuth`.** `quality` conserva el paso 2 estático (`routeDeclarations`, `unparsedRouteLines`, `PUBLIC_MUTATING_ROUTES`); la suite en `quality` aporta la pila real: tabla de todas las rutas (criterio 8) y el 401 real de todas las mutantes (criterio 7).
5. **Criterio 8 exacto.** Sobre la `app.js` real: lista de nombres de capa de nivel app exactamente la de arriba; los tres routers por identidad (`layer.handle === require('../routes/auth')`, `data`, `content`, en ese orden), `notFound` y `errorHandler` por identidad (se requieren después de `appNueva()`); el healthcheck casa con `/healthcheck` y responde `ok`; los routers casan con `API_PREFIX` (`/api/v1`); `trust proxy` vale 1; bidireccional de `ROUTES` (todas las rutas); las protegidas llevan `tokenAuth` primero; ninguna de las públicas lo lleva; no hay `use(tokenAuth)` a nivel de router; lista esperada de capas internas no-ruta de cada router (hoy vacía; si no lo está, se fija exacta).
6. **CORS (criterios 8 y 10h).** Los marcadores estáticos se sustituyen por comportamiento: 403 sin reflejar el origen, `publicMessage` en el cuerpo y `console.warn` con el origen entre comillas JSON y truncado a 200 caracteres. La captura de consola usa `t.mock.method(console, ...)`.
7. **Fecha UTC (criterio 11).** `process.env.TZ = 'Pacific/Kiritimati'` dentro del test y `new Date().getTimezoneOffset() === -840`; restaurar en `after`. Sin proceso hijo. El flujo de `POST /upload` fija la fecha con `mock.timers.enable({ apis: ['Date'], now: 2026-10-28T23:30Z })` (por confirmar en Node 22; si falla se mantiene la fecha real y se anota). No firmar tokens de caducidad bajo el mock.
8. **Unicode.** Antes de escribir los tests, volcar los puntos de código de los literales de las líneas 328 a 330 y 375. En los tests, siempre como escapes (` `, ` `, `́`, `\u0085`), nunca literales. Verificación doble: cada caso asierta que su cadena contiene el escape esperado y `Grep` de los literales sobre `tests/` devuelve cero.
9. **Auditoría.** `quality` usa `npm audit --omit=dev` y no ve `supertest`. En el paso 2 se ejecuta `npm audit --audit-level=high` completo antes y después de instalarlo. Si la línea base está limpia en nivel alto, se añade ese paso al job `verify` (paso 12); si ya hay avisos altos en desarrollo, no se añade, se informa y la excepción se documenta en la tabla S9 de `docs/guias/seguridad.md`. Nunca `npm audit fix --force`.

## Tabla de trazabilidad criterio del script → test

La columna «Casos» recoge las cuentas finales (28/10/2026): casos del script retirado / tests de la suite. La diferencia por criterio es la de las comprobaciones que la suite desdobla o añade (por ejemplo, los bucles con su test de `longitud > 0`) y la de las dos comprobaciones estáticas sustituidas por comportamiento (criterio 8, marcadores de `app.js`, y criterio 10h; decisiones 5 y 6).

| Criterio | Archivo de test | Casos (script / suite) |
|---|---|---|
| 1 | `tests/rutas-publicas.test.js` | 9 / 10 |
| 2 y 3 | `tests/send-email.test.js` | 54 / 56 |
| 4 y 5 | `tests/image-key.test.js` | 62 / 64 |
| 6 y 7 | `tests/rutas-protegidas.test.js` | 72 / 73 |
| 8 | `tests/estructura-rutas.test.js` | 54 / 59 |
| 9 | `tests/respuestas-base.test.js` | 51 / 52 |
| 10 | `tests/errores-controlados.test.js` | 25 / 26 |
| 11 | `tests/fecha-utc.test.js` | 8 / 17 |
| 12 | `tests/provincia.test.js` | 54 / 55 |
| 13 | `tests/upload-excel.test.js` | 24 / 25 |
| 14 | `tests/claves-cliente.test.js` | 72 / 73 |
| 15 | `tests/aws-prefijo.test.js` | 6 / 7 |
| 16 | `tests/index-arranque.test.js` | sin equivalente en el script / 5 casos; total de la suite: 588 (= `MIN_TESTS`) |

Las cuentas de la tabla suman los casos del script retirado y los de la suite con criterio equivalente; el total de la suite es el valor de `MIN_TESTS`. Sin equivalente en el script: `tests/app-importacion.test.js` (4), `tests/convertExcelToJson.test.js` (6), `tests/validadores.test.js` (56) y `tests/index-arranque.test.js` (5, orden de arranque de `index.js`: `validateEnv` antes de `./app`, manejadores de proceso antes, `listen` con `PORT` y propagación del error); el total de la suite está en `MIN_TESTS` y en la tabla de métricas de docs/07. Tests nuevos sin criterio equivalente en el script: `tests/app-importacion.test.js`, `tests/convertExcelToJson.test.js`, `tests/validadores.test.js` y `tests/index-arranque.test.js`. Cobertura del script que debe aparecer en los tests: controles positivos del criterio 6 (`GET /auth` con token válido da 200; `POST /upload/confirm` con token válido llega al manejador, 400), `spyTotal` y contadores globales, multipart real y sin boundary en `/upload` y `/upload-image` por los 3 estados de token, y en el criterio 2 `sendMail === 5` con el 429 a la sexta.

## Fase 1: separación, cimientos y primeras migraciones

1. **Separar `app.js` de `index.js` (M13), ajustar herramientas y fijar la línea base.**
   - Archivos: `app.js` (crear), `index.js`, `scripts/verificar-rutas.mjs` (lectura de `app.js` y modo `--lista`), `scripts/lib/repo.mjs`, `scripts/docs-check.mjs`.
   - `app.js` agrupa `express`, `cors`, `compression`, `morgan`, `errorHandler`, `notFound`, los routers, `API_PREFIX`, `trust proxy`, el healthcheck y `originNotAllowed`, con el orden actual, y termina con `module.exports = app;`. `index.js` queda con `dotenv`, `uncaughtException`, `unhandledRejection`, `validateEnv()`, `require('./app')`, `PORT` y `listen`. `repo.mjs`: `codeFiles` incluye `app.js` y se actualiza el comentario del criterio 8. `docs-check.mjs`: las líneas ~46 (lectura de `/healthcheck`), ~49 (filtro `apiRoutes`) y ~195 a 197 (nombre del check) pasan de `index.js` a `app.js`.
   - Antes de editar: `npm run verificar:rutas` y guardar la salida por criterio.
   - Comprobación: mismas cuentas por criterio; `npm start` y `GET /healthcheck` dan 200 `ok`; `npm run lint` y `npm run quality` pasan; `--lista` imprime todos los casos; `docs:check` fallará hasta cerrar la documentación (esperado).
   - Norma: `docs/guias/buenas-practicas-backend.md` (M13). El comportamiento no cambia.
2. **Infraestructura de tests y prueba de importación.**
   - Archivos: `package.json`, `package-lock.json`, `eslint.config.js`, `tests/helpers/entorno.js`, `tests/helpers/simulados.js`, `tests/helpers/pila.js`, `tests/app-importacion.test.js`.
   - `"test": "node --test \"tests/**/*.test.js\""` (`verificar:rutas` se mantiene hasta el paso 11); `npm install -D -E supertest@7.3.1` (versión exacta como las demás devDependencies; por confirmar versión y `npm audit`). `eslint.config.js`: bloque `files: ['tests/**/*.js']` con `no-console: off` y desactivadas `security/detect-non-literal-fs-filename`, `detect-non-literal-regexp` y `detect-object-injection` (misma justificación que el bloque de `scripts/**/*.mjs`); `no-unused-vars` y `eqeqeq` siguen activas; `--max-warnings` no sube. `simulados.js`: espías, contadores con reinicio por test, `nextIp`, tokens (válido, inválido, caducado) y `appNueva()`. `pila.js`: `declaredRoutes(app)`. `app-importacion.test.js`: importar `app.js` no abre puerto, `require.cache` no contiene `config/validateEnv.js`, `trust proxy` vale 1, `/healthcheck` da `ok` y el proceso termina solo.
   - Comprobación: `npm test` sale con 0 sin `.env`, sin credenciales y sin red; avisos de ESLint medidos antes y después (no suben); `npm audit --audit-level=high` completo antes y después de instalar (decisión 9); si el archivo de importación se cuelga por temporizadores del limitador, se detecta aquí.
   - Norma: `docs/guias/seguridad.md` (dependencias, S9; sin `--force`) y `docs/guias/buenas-practicas-backend.md` (tests).
3. **Pruebas unitarias de funciones puras, con criterio 12.**
   - Archivos: `tests/convertExcelToJson.test.js`, `tests/validadores.test.js` (`validateDataKey`, `validateImageKey`, `validateContactMessage`), `tests/provincia.test.js`.
   - Sin cambios en producción. Casos de caracterización; `provincia.test.js` migra uno por uno los del criterio 12 con los mismos nombres. Cada bucle lleva su aserción `longitud > 0`.
   - Comprobación: `npm test` pasa; nombres de los casos del criterio 12 iguales a la lista base.
4. **Criterios 1 a 5.**
   - Archivos: `tests/rutas-publicas.test.js`, `tests/send-email.test.js`, `tests/image-key.test.js`.
   - `supertest` sobre `appNueva()`. Todas las rutas públicas de la tabla, con `longitud > 0`. Criterio 2: cinco peticiones anónimas válidas dan 200, `sendMail === 5`, la sexta da 429 con envoltorio (y con token válido sigue limitada), otra IP pasa, cinco 400 cuentan para el límite. Criterio 3: casos con U+2028, U+2029, U+0085 y U+0301 en escapes. Criterios 4 y 5: `imageKey` en GET y DELETE, con espías de S3 a 0 en los inválidos.
   - Comprobación: `npm test` pasa; `Grep` de literales Unicode sobre `tests/` vacío; `npm run verificar:rutas` sigue verde.
5. **Criterios 6 y 7.**
   - Archivo: `tests/rutas-protegidas.test.js`.
   - Cada ruta protegida × 3 estados de token con mensajes exactos; multipart real y sin boundary en `/upload` y `/upload-image` por los 3 estados; variantes `/UPLOAD` y `/upload/`; controles positivos; mutantes de la pila (`declaredRoutes`) con 401 y sin llamadas a S3 ni SMTP, excluyendo `POST /log` y `POST /send-email`, con `mutantes > 0`.
   - Comprobación: `npm test` pasa; contadores de espías a 0 tras cada 401.

## Fase 2: resto de criterios y equivalencia

6. **Criterio 8: estructura exacta de la pila.** Archivo: `tests/estructura-rutas.test.js`. Todo lo de la decisión 5. Comprobación: pasa; mutaciones temporales, revertidas sin commit, que deben hacerlo fallar: quitar `tokenAuth` de una ruta protegida; añadir una ruta sin clasificar; añadir una mutante con `router.route('/x').post(...)`; mover `notFound` antes de los routers; añadir `app.use((req, res, next) => next())`.
7. **Criterios 9 y 10.** Archivos: `tests/respuestas-base.test.js`, `tests/errores-controlados.test.js`. Criterio 9: tokens inválidos en rutas abiertas, 404 con envoltorio sin 405 ni `Allow` (inexistentes, métodos no definidos, fuera del prefijo), `/healthcheck`, `OPTIONS` con y sin origen permitido, 403 sin reflejar el origen, 400 `Invalid JSON`. Criterio 10: casos a a j con `t.mock.method(console, 'error')` y `t.mock.method(console, 'warn')`. Comprobación: pasa; mutación temporal: devolver `err.message` en `errorHandler` hace fallar el criterio 10.
8. **Criterios 11, 13 y 14.** Archivos: `tests/fecha-utc.test.js`, `tests/upload-excel.test.js`, `tests/claves-cliente.test.js`. Fecha con huso por defecto y Kiritimati (decisión 7); Excel en memoria con `exceljs`, provincia válida e inválida y borradores con `draftKey`; claves de upload/confirm, update-file y delete-file válidas e inválidas, sin tocar S3. Comprobación: `npm test` pasa.
9. **Criterio 15.** Archivo: `tests/aws-prefijo.test.js`. `aws/awsS3connect.js` real, `S3Client.prototype.send` parcheado y restaurado en `after`. Comprobación: pasa; no hay red.
10. **Verificar equivalencia caso a caso (sin archivos de código).** Ejecutar `node scripts/verificar-rutas.mjs --lista` y la suite con `--test-reporter=tap` y comparar por nombre: toda línea `criterio|nombre` de la lista base debe tener un subtest con el mismo nombre en el archivo de su criterio; informar de diferencias en ambos sentidos; completar la columna de cuentas; correr `npm test` también con `TZ=Pacific/Kiritimati` y bajo Node 22 (si el local no es 22, `npx -p node@22 node --test ...`, por confirmar). Si falta un caso, se corrige aquí y no se retira el script.

## Fase 3: retirada del script, CI y configuración

11. **Retirar el script y rehacer el paso de rutas de `quality`** (solo con equivalencia total del paso 10). Archivos: `scripts/verificar-rutas.mjs` (eliminar), `package.json` (quitar `verificar:rutas`), `scripts/quality-check.mjs`, `scripts/lib/repo.mjs`. El paso 7 ejecuta la suite según la decisión 3; el paso 4 (secretos) añade los `.js` de `tests/` a la lista `files` sin tocar `codeFiles` (para no alterar las métricas de `docs-check`); se corrigen los comentarios de `repo.mjs`. Comprobación: `grep` de `verificar-rutas` y `verificar:rutas` fuera de `docs/specs/` históricos devuelve cero; `npm run quality` pasa; con `it.skip` o `it.todo` temporal `quality` falla; con el glob vacío (renombrar `tests/` temporalmente) falla; con una mutante `router.route` sin `tokenAuth` falla por la suite.
12. **CI.** Archivo: `.github/workflows/ci.yml`. Paso `Tests` con `npm test` en el job `verify` tras `docs:check`, sustituyendo el bloque comentado; paso `npm audit --audit-level=high` si la línea base lo permite (decisión 9); el comentario de cabecera deja de decir que `npm test` no se incluye; `--exclude "tests/*"` en el zip (`app.js` queda dentro). Comprobación: lectura del workflow; listado local del zip con la misma orden (`app.js` presente, `tests/` ausente); `plugins/*/tests` ya viajaba en el zip: se señala, no se toca; (por confirmar en CI real).
13. **Configuración del flujo (aprobado por el usuario).** Archivo: `.claude/flujo.json`: `app.js` en `areasContrato` y en `docsPorArea`, con los mismos documentos que `index.js`. Comprobación: `npm run docs:gate` reconoce `app.js`. Norma: `.claude/**` pide actualizar `docs/README.md`.

## A cargo del tester-documentador

- `docs/07-estado-y-deuda-tecnica.md`: M13 resuelto con fecha y commit; M11 parcial con lo que falta (flujo upload/confirm/delete con S3 simulado con estado y el resto de módulos); métricas con `npm run docs:check -- --metrics` (archivos de código +`app.js`, dependencias de desarrollo, archivos de test); reemplazar las menciones históricas a `scripts/verificar-rutas.mjs` y `verificar:rutas` por la suite; fecha «actualizado»; ajustar la nota de la métrica de tests.
- `docs/01-arquitectura.md`, `docs/04-api.md` (la fila de `/healthcheck` pasa a `app.js`), `docs/05-modulos.md` (sección `app.js`, quitar `verificar:rutas`) y `docs/README.md` (estructura con `app.js` y `tests/`).
- `docs/03-configuracion.md`: fila de `npm test` real, fila de `verificar:rutas` eliminada, fila de `quality` ajustada, áreas de `index.js` y `app.js`.
- `docs/02-tecnologias.md`: fila de `supertest` con la versión del lock; `node:test` en prosa fuera de la tabla; quitar la frase de «sin tests».
- Guías (`mantenimiento.md`, `buenas-practicas-backend.md`, `seguridad.md`): quitar `verificar:rutas` y la sección del script M21; `npm test` entra en la definición de terminado; cómo escribir y ejecutar tests; la comprobación de rutas protegidas vive en la suite y en `quality`; tabla S9 y excepción de auditoría de desarrollo si procede.
- `CLAUDE.md`: el comando `npm test` deja de ser el placeholder. `docs/integracion/para-infra.md`: revisar la mención del despliegue desde la CI (exclusión de `tests/*`).
- Aviso de PR `docs/specs/2026-10-28-m13-m11-aviso-pr.md`: `.github/**`, `package.json` e `index.js` son áreas de contrato; recoger paso `npm test`, exclusión de `tests/*` del zip, paso de auditoría y la devDependency nueva.
- Completar la tabla de trazabilidad con las cuentas finales. `plugins/README.md` y `npm run agentes:test` no aplican (no se toca `plugins/`).

## Pruebas

- Nuevas: los archivos de la tabla, `tests/app-importacion.test.js`, `tests/convertExcelToJson.test.js`, `tests/validadores.test.js` y `tests/helpers/*` (estos últimos no son tests). Los cuenta `docs:check` con la expresión actual.
- Verificación final: `npm test`, `npm run lint`, `npm run quality`, `npm run docs:check`, `npm run docs:gate` (antes del commit). `agentes:test` no aplica. Las mutaciones de los pasos 6, 7 y 11 son temporales y se revierten.

## Por confirmar

Versión 7.3.1 de `supertest` y el resultado de `npm audit` completo; formato exacto del resumen del reporter TAP de Node 22; `mock.timers` con `Date`; que el proceso de importación termine solo; `n/no-missing-require` con `node:test` y el recuento de avisos de ESLint; ruido de `morgan('combined')` (plan B: inyectar un `morgan` sin salida en la caché y ajustar la aserción de la capa `logger` en ese archivo); contenido real del zip en CI; nombres `notFound` y `errorHandler` de las capas; ejecución en Node 22 si el local es otro; `docs:check` falla en el intermedio hasta cerrar la documentación.
