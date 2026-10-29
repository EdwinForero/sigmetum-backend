# M15, M6, B6, B8 y B2: validación de entorno, límite de subida, JWT y limitadores: plan

Fecha: 2026-10-28 · Estado: cerrado · Spec: `docs/specs/2026-10-28-m15-m6-b6-b8-b2-pequenos-design.md`

Crítico: sí (autenticación y JWT; contrato con el frontend; CI por `MIN_TESTS`). Segunda opinión sobre el plan: recibida (un crítico y varios importantes) e incorporada en esta versión; las decisiones del usuario sobre M6, `JWT_EXPIRATION` y la política por `NODE_ENV` están recogidas abajo.

## Discrepancias spec/código y decisiones de diseño

1. **B2: solo el script `dev`.** `nodemon` ya está en `devDependencies` (`package.json:43`) y el lock lo marca `"dev": true`. No hay `npm install` ni cambio de lock; las métricas de dependencias de `docs/07` se quedan como están (no se recalculan a mano: se verifican con `npm run docs:check -- --metrics`).
2. **B6 es solo estilo.** En `express-rate-limit` 8.5.2, `max` sigue en `knownOptions` y se traduce con `limit: passedOptions.max ?? 5`; `limit` lo pisa. No existe un aviso de obsolescencia que medir. Se prueba con el límite real, las cabeceras y que el código fuente de las dos rutas no use `max:`.
3. **M6.** multer 1.4.5-lts.1 rechaza el tamaño exactamente igual a `fileSize` (999→200, 1000→400 con `fileSize=1000`). Decisión del usuario: el máximo aceptado es exacto, así que `fileSize = MAX + 1`. Un único mensaje fijo, sin cifras: `File exceeds the maximum allowed size`.
4. **M15 `JWT_EXPIRATION`.** `isValidExpiration(value)`: si coincide con `/^-?\d+(\.\d+)?$/` (solo número, sin unidad) es inválido (en `jsonwebtoken` `'3600'` son milisegundos); si no, `jwt.sign({}, 'x', { expiresIn: value })` dentro de `try/catch` (si lanza, inválido) y se exige `exp - iat > 0` con `jwt.decode` (cubre `'0h'` y `'0s'`). `'-1'` y `'-5m'` los rechaza `ms` (su regex no admite signo) y se prueban igualmente. No se usa `require('ms')` (dependencia transitiva).
5. **M15 política (decisión del usuario).** `lenient = ['local', 'test'].includes(process.env.NODE_ENV)`. Si es lenient, solo `console.warn`; en cualquier otro caso (sin `NODE_ENV`, `production`, `staging`…) lanza `Error` (falla cerrado). La nota de `OPTIONAL_ENV` en `scripts/quality-check.mjs:30` («sin valor se comporta como producción») es exacta con esta política; es un comentario y no se edita. Consecuencia de despliegue: un Beanstalk sin `NODE_ENV` pasa a ser estricto y los valores reales deben cumplir las reglas.
6. **Forma del hash.** `/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/` completa (un valor truncado daría 401 en todos los logins).
7. **Mensajes de `validateEnv`.** En español, fijos, solo con el nombre de la variable y la regla, nunca el valor (p. ej. `JWT_SECRET: debe tener al menos 32 caracteres`).
8. **Cuidado con `quality`.** Su patrón prohíbe, en una misma línea, `console.*(` con las palabras sueltas `password`, `secret` o `token`. `ADMIN_PASSWORD` y `JWT_SECRET` no lo disparan (`_` es carácter de palabra), pero el texto se construye fuera de la línea del `console.warn`. Los hashes bcrypt de los tests se generan con `bcrypt.hashSync('x', 4)`, nunca literales (el escáner de secretos los detecta).

## Fase 1

1. **M15: validar el valor de las variables de entorno (TDD).**
   - Archivos: `tests/validate-env.test.js` (crear); `config/validateEnv.js` (modificar).
   - `validateEnv()` sin cambios de firma ni de export. Añade `require('jsonwebtoken')`, la regex del hash, `MIN_JWT_SECRET_LENGTH = 32` e `isValidExpiration`. Primero el chequeo de ausentes, sin cambios; después las reglas de valor, solo de las presentes. Con incumplimientos: lenient → `console.warn` por regla con el mensaje ya construido; estricto → `throw new Error` con la lista.
   - Pruebas (el archivo empieza con `require('./helpers/entorno')`; guardan y restauran `process.env` por caso y mockean `console.warn` con `t.mock.method`): matriz de `NODE_ENV` (`undefined`, `production` y `staging` lanzan con valor inválido; `local` con `AWS_PROFILE` fijado y restaurado, y `test`, no lanzan y avisan nombrando variable y regla); `ADMIN_PASSWORD` (hash válido con `hashSync('x', 4)`; inválidos: texto plano y hash truncado); `JWT_SECRET` (31 falla, 32 pasa); `JWT_EXPIRATION` válidos `8h`, `10m`, `1d`, `8H`, `1 day`, `1.5h` e inválidos `3600`, `0`, `-1`, `-5m`, `0h`, `10m ` (espacio final), `abc`; `''` cuenta como ausente (mensaje existente); centinelas del estilo `CENTINELA-XYZ` no aparecen ni en `error.message` ni en los argumentos de `console.warn`; con todo válido no se llama a `console.warn`.
   - `tests/helpers/entorno.js` no se toca (fija `NODE_ENV=test`, `JWT_SECRET` de 34 caracteres, `JWT_EXPIRATION='1h'` y un `ADMIN_PASSWORD` que no es hash: solo avisaría). Hoy no hay test del `validateEnv` real: `tests/index-arranque.test.js` lo simula y `tests/app-importacion.test.js` comprueba que no se carga.
   - Comprobación: `node --test tests/validate-env.test.js`; debe fallar antes del cambio por el motivo correcto (no lanza / no avisa).
   - Norma: `docs/guias/seguridad.md` (secretos y logs). Contrato: `docs/integracion/para-infra.md` (condición previa de despliegue).
2. **M6: límite de tamaño de ficheros (TDD).**
   - Archivos: `tests/limite-subida.test.js` (crear); `middleware/errorHandler.js`, `routes/data.js:22` y `routes/content.js:21` (modificar).
   - `routes/data.js`: `MAX_UPLOAD_BYTES = 10 * 1024 * 1024` y `multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES + 1 } })`. `routes/content.js`: igual con `5 * 1024 * 1024`. Comentario junto a cada constante: multer rechaza el tamaño igual a `fileSize`, por eso se suma 1.
   - `errorHandler.friendlyMessage`, antes de la línea genérica de `MulterError`: `if (name === 'MulterError' && code === 'LIMIT_FILE_SIZE') return 'File exceeds the maximum allowed size';`. El 400 ya sale por la regla existente; los demás `MulterError` siguen con `File upload error: <mensaje>` (test `e` de `tests/errores-controlados.test.js`). No se refleja `err.message`. El orden `tokenAuth` y luego `upload.single(...)` ya es correcto y no se cambia.
   - Pruebas con `validToken`, `appNueva`, `spyTotal` y `calls` de `simulados.js`, verificando empíricamente el multer instalado con `MAX + 1`: `/upload` (nombre `.txt`): `MAX - 1` y `MAX` dan 400 `Only .xlsx files are allowed`; `MAX + 1` (nombre `.xlsx`) da 400 con el mensaje fijo y `spyTotal() === 0`. `/upload-image` (con `title` válido): `MAX - 1` y `MAX` dan 200 y `calls.s3Other === 1`; `MAX + 1` da 400 con el mensaje fijo y `spyTotal() === 0`. Sin token y con fichero pequeño: 401 (no enviar el fichero grande sin token: puede dar `EPIPE` con supertest).
   - Comprobación: `node --test tests/limite-subida.test.js tests/errores-controlados.test.js`.
   - Norma: `buenas-practicas-backend.md` (errores) y `seguridad.md` (subida de archivos). Contrato: `para-frontend.md` (400 nuevo, compatible, por confirmar el manejo en el frontend).
3. **B8: fijar el algoritmo JWT (TDD).**
   - Archivos: `tests/jwt-algoritmo.test.js` (crear); `functions/tokenAuthentication.js:11` y `functions/userAuthentication.js:34` (modificar).
   - `jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }, callback)` y `jwt.sign(..., { expiresIn: JWT_EXPIRATION, algorithm: 'HS256' })`. Verificado en `jsonwebtoken` 9.0.2: `sign.js:98` usa `options.algorithm || 'HS256'` (los tokens ya emitidos siguen valiendo); sin `algorithms`, `verify.js:132-134` aceptan HS256, HS384 y HS512.
   - Pruebas con `GET /api/v1/auth`: HS512 firmado con `TEST_SECRET` → 401 `Invalid token` (falla antes del cambio); `alg: none` → 401 (ya lo rechaza `verify.js:116-117`: sirve de regresión); `validToken` (sin algoritmo indicado) → 200; `POST /log` devuelve un token con `jwt.decode(token, { complete: true }).header.alg === 'HS256'` (tras `require('./helpers/entorno')` y antes de `appNueva()`, fijar `process.env.ADMIN_PASSWORD = require('bcrypt').hashSync('x', 4)` y usar la contraseña `'x'`, `username: 'admin-de-prueba'` y `nextIp()`; va en un archivo propio porque `userAuthentication.js` lee el entorno al cargar).
   - Comprobación: `node --test tests/jwt-algoritmo.test.js`. Norma: `seguridad.md` (S2). Contrato: `para-frontend.md` (el JWT no cambia de campos ni de caducidad).
4. **B6: `max` a `limit`.**
   - Archivos: `tests/limitadores.test.js` (crear); `routes/auth.js:9` y `routes/content.js:35` (modificar): `max: 10` → `limit: 10` y `max: 5` → `limit: 5`; `standardHeaders` y `legacyHeaders` no se tocan.
   - Pruebas: `POST /log` con usuario inexistente da 401 las 10 primeras veces y la 11.ª da 429 con `Too many login attempts. Please try again in 15 minutes.`; las cabeceras `ratelimit-limit` valen 10 y 5 y `ratelimit-policy` es `10;w=900` y `5;w=900`; una prueba lee SOLO `routes/auth.js` y `routes/content.js` y exige que no contengan `\bmax\s*:` (la única que falla antes del cambio). El límite de 5 de send-email ya está en `tests/send-email.test.js`: no se duplica.
   - Comprobación: `node --test tests/limitadores.test.js tests/send-email.test.js`. Norma: fila B6 de `docs/guias/buenas-practicas-backend.md`.
5. **B2: script `dev`.**
   - Archivo: `package.json`: añadir `"dev": "nodemon index.js"` en `scripts`, después de `start`. Sin tocar dependencias ni lock.
   - Comprobación: `node -e "console.log(require('./package.json').scripts.dev)"` imprime `nodemon index.js`; `npm run docs:check` fallará hasta que el tester añada la fila a la tabla de scripts de `docs/03`.

## Fase 2

6. **Cierre técnico.**
   - Archivos: `scripts/quality-check.mjs` (`MIN_TESTS`, línea ~208) y `package.json` (solo si cambia el aviso de ESLint).
   - `MIN_TESTS = 588` pasa al nuevo total exacto: el developer ejecuta `npm test`, lee `# tests N` del resumen y fija `MIN_TESTS = N`. Si `npm run lint` mejora el número de avisos, bajar `--max-warnings` al real (hoy 5).
   - Comprobación: `npm test`, `npm run lint` y `npm run quality` pasan; si `quality` falla por algo previo (p. ej. M20), se dice sin taparlo.

## A cargo del tester-documentador

- `docs/guias/seguridad.md`: ~36 («M15 no se valida al arrancar»: ahora sí, con la política y las reglas), ~78 («No cumple (M6)»: ahora cumple, 10 y 5 MB), ~91 (limitadores con `limit`).
- `docs/03-configuracion.md`: fila `npm run dev` en la tabla de scripts (lo exige `docs:check`); quitar `npx nodemon index.js` (líneas ~9 y ~27); reglas de valor de `ADMIN_PASSWORD`, `JWT_SECRET` (mínimo 32) y `JWT_EXPIRATION` (con unidad; rechaza solo números y duraciones ≤ 0); la política (estricta salvo `NODE_ENV` exactamente `local` o `test`).
- `docs/02-tecnologias.md`: la fila de `nodemon` ya no dice «no hay script configurado». `docs/04-api.md`: límites, 400 con mensaje fijo y HS256. `docs/05-modulos.md`: `validateEnv`, `tokenAuthentication`, `userAuthentication`, `errorHandler` (mapeo de `LIMIT_FILE_SIZE`), `routes/data.js` y `routes/content.js`.
- `docs/integracion/para-infra.md`: condición previa de despliegue de M15 con la política nueva (sin `NODE_ENV` ya es estricto: los valores reales deben cumplir); línea ~112 («`multer` sin límite de tamaño»); líneas ~29 (`JWT_EXPIRATION`) y ~50 (`NODE_ENV`; valor real de Beanstalk por confirmar); constancia de que no se han visto valores reales. `docs/integracion/para-frontend.md`: el 400 nuevo y los límites (compatible; por confirmar el manejo en el frontend); B8 sin impacto.
- `.env.example`: comentarios con las reglas; `JWT_SECRET` y `ADMIN_PASSWORD` siguen vacías (o `quality` falla). `docs/guias/buenas-practicas-backend.md`: quitar o reescribir la fila de B6.
- `docs/07-estado-y-deuda-tecnica.md`: M6, M15, B2, B6 y B8 resueltos con fecha; B9 sigue abierto; fecha «actualizado»; dependencias sin cambio; «Archivos de test» de 16 a 20 (verificar con `npm run docs:check -- --metrics`); mención de que el `.env` local de desarrollo (`NODE_ENV=local`) solo avisará, y que su `ADMIN_PASSWORD` no es un hash, sin escribir valores.
- Aviso de PR `docs/specs/2026-10-28-m15-m6-b6-b8-b2-aviso-pr.md` (se tocan áreas de contrato) y `npm run docs:gate` antes del commit.

## Pruebas

- Nuevas: `tests/validate-env.test.js`, `tests/limite-subida.test.js`, `tests/jwt-algoritmo.test.js` y `tests/limitadores.test.js`. Existentes que deben seguir pasando: `tests/errores-controlados.test.js`, `tests/send-email.test.js`, `tests/rutas-protegidas.test.js`, `tests/index-arranque.test.js` y `tests/app-importacion.test.js`.
- Verificación final: `npm test`, `npm run lint`, `npm run quality`, `npm run docs:check`, `npm run docs:gate`. `agentes:test` no hace falta (no se toca `plugins/`).

## Por confirmar

Valores reales de `JWT_SECRET`, `ADMIN_PASSWORD` y `JWT_EXPIRATION` en Beanstalk y su `NODE_ENV`; que el frontend no suba ficheros por encima de los límites y muestre el mensaje del 400; que los tokens vigentes sigan valiendo tras B8; el comportamiento de multer con `MAX + 1` (lo resuelve la prueba de frontera); cifras de métricas y `npm audit` (las ejecuta el tester).
