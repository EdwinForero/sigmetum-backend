# B7 y M24 (a, b): plan

Fecha: 2026-10-30 · Estado: cerrado · Spec: `docs/specs/2026-10-30-b7-m24-limpieza-estructura-y-controles-design.md`

Crítico: sí (entrada de `criticidad`: autenticación y JWT; se mueve `tokenAuth` y el login cambia de archivo, aunque el comportamiento no cambia). No coincide con CI, dependencias, claves de S3 ni contrato con el frontend. Sin veto. Sin rutas nuevas: `tests/estructura-rutas.test.js` no cambia su clasificación.

## Supuestos y alternativas

- Movimiento sin cambio de comportamiento: `tokenAuth` se copia literal y `userAuth` se pega literal, con las mismas lecturas de `process.env` al cargar el módulo.
- Riesgo de test, no de producción: `tests/helpers/simulados.js:80` y `tests/s3-robustez.test.js:50` borran `routes/auth.js` de `require.cache` en cada `appNueva()`. Antes `userAuthentication.js` se cargaba una sola vez; ahora `JWT_SECRET`, `ADMIN_*` y `users` se releen en cada recarga. `tests/helpers/entorno.js` y `jwt-algoritmo.test.js` fijan el entorno antes de la primera carga y `node --test` aísla cada archivo en su proceso, así que no se espera diferencia. Si algún test falla por esto, el developer no lo arregla: lo devuelve como pregunta.
- (b) Descartado: `spawnSync` con `shell: true`, como hoy (el `timeout` mata el shell y deja huérfanos `node --test` y sus hijos); quitar `shell` y llamar a `node` directo (los hijos del runner seguirían huérfanos y el glob entre comillas dependería de la versión de Node). Propuesta: ayudante asíncrono que mata el árbol de procesos (`taskkill /T /F` en Windows; grupo de procesos con `detached` y `kill(-pid)` en POSIX), solo para la suite.
- (a) Descartado: ejecutar `docs-check` como subproceso con un `index.js` modificado (frágil). Propuesta: función pura `routesInIndex(source)` en `scripts/lib/repo.mjs`, comprobable con fuente simulada.
- `MIN_TESTS`: se sube al recuento real al final, sin tocar el mecanismo; no entra en la decisión pendiente (c).

## Fase 1: B7 (mover y fusionar)

1. **Test de capas en rojo (TDD)**
   - Archivo (modificar): `tests/capas-importaciones.test.js`.
   - `problemasDe` añade la regla: si la capa de origen es `middleware` y la de destino es `aws`, es un problema (`middleware/ importa aws/`). Casos nuevos con fuentes en cadena: `middleware/` importando `aws/` falla (1 problema); camino con `..` a `aws/` falla; `middleware/` puede importar `config/` y su propia capa (0 problemas); una importación no literal también falla. El `describe` real pasa a «capas reales: aws/, functions/ y middleware/» y el test de recorrido añade que hay archivos en `middleware/`. Los demás tests no se tocan ni se debilitan.
   - Comprobación: los casos nuevos fallan antes de añadir la regla y pasan después (`node --test tests/capas-importaciones.test.js`).
   - Norma: `docs/guias/buenas-practicas-backend.md` (tabla de capas y reglas de dependencia); spec, criterio de código 4.

2. **Mover `tokenAuth` a `middleware/`**
   - Crear `middleware/tokenAuthentication.js` con el contenido idéntico al de `functions/tokenAuthentication.js` (misma sangría y mensajes, `module.exports = { tokenAuth }`); borrar `functions/tokenAuthentication.js`. Cambiar la importación en `routes/data.js`, `routes/content.js`, `routes/auth.js` (se reescribe en el paso 3), `tests/estructura-rutas.test.js` y `tests/helpers/pila.js` (ruta `../middleware/tokenAuthentication`; en `pila.js`, `../../middleware/tokenAuthentication`).
   - Comprobación: `tests/estructura-rutas.test.js` (primer manejador de las rutas protegidas y sin `use(tokenAuth)`), `tests/rutas-protegidas.test.js` y `tests/jwt-algoritmo.test.js` pasan sin cambiar expectativas; `npm run lint` detecta un require faltante; `grep functions/tokenAuthentication` fuera de `docs/specs/` sin resultados.

3. **Fusionar el login en `routes/auth.js`**
   - Modificar `routes/auth.js`; borrar `functions/userAuthentication.js`; en `tests/jwt-algoritmo.test.js` solo el comentario de la cabecera (`routes/auth.js` lee el entorno al cargarse).
   - En `routes/auth.js` se añaden `jwt` y `bcrypt`, las constantes `JWT_SECRET`, `JWT_EXPIRATION`, `USERNAME`, `PASSWORD`, el array `users` y `const userAuth = async (...)` con el cuerpo idéntico, antes de `router.post('/log', loginLimiter, userAuth)`. No se exporta `userAuth` (solo `module.exports = router`). La línea de la ruta se mantiene en una sola línea para que `routeDeclarations` y `unparsedRouteLines` la sigan viendo. Se elimina la importación de `../functions/userAuthentication`.
   - Comprobación: `tests/jwt-algoritmo.test.js` y los tests de login existentes (400/401/200, limitador, `errores-controlados`) pasan sin cambios; `grep functions/userAuthentication` sin resultados; `npm run quality` sigue con la excepción `POST /log` y sin avisos de variables de entorno.
   - Norma: buenas prácticas (manejador `async` con `try/catch` y `next(error)`, que se conserva); seguridad (`POST /log` como excepción registrada).

4. **Actualizar `.claude/flujo.json`**
   - `docsPorArea`: la clave `functions/tokenAuthentication.js` pasa a `middleware/tokenAuthentication.js` con los mismos tres docs (03, 04, 05); la clave `functions/userAuthentication.js` pasa a `routes/auth.js` con 03, 04 y 05. `areasContrato`: `functions/tokenAuthentication.js` pasa a `middleware/tokenAuthentication.js`; se elimina `functions/userAuthentication.js` (lo cubre `routes/**`).
   - Comprobación: `npm run agentes:test` y `docs-gate.mjs --solo-validar`; si `docsDeArea` resolviera de otro modo la ambigüedad entre `routes/**` y `routes/auth.js`, se comprueba con `npm run docs:gate` al cierre.

5. **Retirar el rastro de `uploads/`**
   - `.gitignore` (quitar la línea `uploads/`), `eslint.config.js` (`ignores: ['node_modules/**']`), `scripts/lib/repo.mjs` (`IGNORED = new Set(['node_modules', '.git'])`).
   - Comprobación: `grep uploads` fuera de `docs/` y `node_modules` sin resultados; `npm run lint`, `npm run quality` y `npm run docs:check` pasan.

## Fase 2: M24 (a) y (b)

6. **(a) `docs-check` falla si `index.js` declara rutas, con test en rojo**
   - Crear `tests/controles-scripts.test.js`; modificar `scripts/lib/repo.mjs` (nueva `export const routesInIndex = (source)`: devuelve las líneas que casan con una expresión de declaración de ruta `app.` o `router.` seguida de `get|post|put|patch|delete|all|use|route(` al inicio de línea, sin tocar `app.listen`); modificar `scripts/docs-check.mjs` (nuevo bloque `check('index.js no declara rutas (solo arranca el servidor)', ...)` con `routesInIndex(read('index.js'))`).
   - El test importa con `await import(pathToFileURL(...).href)` dentro de los tests (la suite es CommonJS). Casos: `index.js` real da `[]`; `app.get('/x', h)`, `app.use('/x', r)` y `router.post('/y', h)` dan 1 cada uno; `app.listen(PORT, ...)`, un comentario con `app.get(` y `app.use(cors())` en otro archivo dan 0.
   - Comprobación: el test falla primero porque no existe `routesInIndex`; después `npm test`; comprobación manual del criterio 7: añadir una ruta temporal a `index.js`, ver fallar `npm run docs:check`, revertir y ver que pasa.
   - Norma: `mantenimiento.md` sección 3; buenas prácticas («`index.js`: lógica, middlewares y rutas» como prohibido).

7. **(b) `quality-check` sin procesos huérfanos al agotar el tiempo máximo, con test en rojo**
   - Ampliar `tests/controles-scripts.test.js`; en `scripts/lib/repo.mjs` nueva `export const runWithTimeout = (command, args, { timeout, maxBuffer } = {})` asíncrona: `spawn(command, args, { cwd: ROOT, shell: true, detached: process.platform !== 'win32' })`, acumula `stdout` y `stderr`; al vencer el tiempo mata el árbol (`taskkill /PID <pid> /T /F` en win32; `process.kill(-pid, 'SIGKILL')` en POSIX); resuelve `{ status, stdout, stderr, error }` con `status: null` y `error: { code: 'ETIMEDOUT' }` si venció; `maxBuffer` como tope de acumulación. En `scripts/quality-check.mjs` (suite): `const suite = await runWithTimeout('node', ['--test', '--test-reporter=tap', '"tests/**/*.test.js"'], { timeout: 180000, maxBuffer: 64 * 1024 * 1024 })`, conservando el uso de `suite.error?.code === 'ETIMEDOUT'` y el resto del bloque.
   - Test: crea con `fs.mkdtempSync` (en el directorio temporal del sistema) un `.js` simulado que lanza un nieto de larga vida con `child_process` (dentro del contenido escrito, no con `require` en el test, porque la regla `n/no-restricted-require` aplica a los tests), imprime el pid del nieto y espera; el test llama `runWithTimeout('node', ['"<ruta>"'], { timeout: 1500 })`, comprueba `error.code === 'ETIMEDOUT'`, espera unos 300 ms y comprueba que `process.kill(pid, 0)` lanza `ESRCH`. Caso positivo: un comando rápido devuelve `status 0` y su `stdout`, sin `error`.
   - Comprobación: falla primero porque no existe `runWithTimeout`; el developer comprueba, de forma temporal y sin dejar rastro, que una versión sin matado del árbol hace fallar el test por el motivo correcto (nieto vivo). `npm test` y `npm run quality` pasan.
   - Norma: `seguridad.md` (S10: `child_process` fuera de la API; los scripts de `scripts/` quedan fuera de `codeFiles`); `mantenimiento.md` sección 3.

8. **Subir `MIN_TESTS` y cerrar la verificación**
   - `scripts/quality-check.mjs`: `MIN_TESTS` al recuento real de `npm test`; solo el número. Comprobación: `npm test` (ningún test borrado), `npm run lint`, `npm run quality`, `npm run docs:check` y `npm run agentes:test` (se tocó `.claude/`, no `plugins/`).

## Ajustes aprobados tras la segunda opinión (obligatorios para el developer)

- **Paso 4 (flujo.json):** NO añadir la clave `routes/auth.js` a `docsPorArea`: `routes/**` ya cubre el login y así no se relaja el cierre documental. Solo se renombra la clave de `tokenAuthentication` a `middleware/tokenAuthentication.js` y se elimina la de `userAuthentication.js`; en `areasContrato` se usa `middleware/tokenAuthentication.js` (no `middleware/**`, para no meter `notFound`).
- **Paso 3:** tras fusionar el login, ejecutar `npm test` COMPLETO (no solo los archivos de login) por la recarga de `routes/auth.js` en `appNueva()`.
- **Paso 7, `runWithTimeout` robusto:** resolver en el propio temporizador con una guarda de «ya resuelto», tras matar el árbol, sin esperar al evento `close`; manejar `child.on('error')` resolviendo con `{ status: null, error }`; `clearTimeout` en cuanto el proceso termine; `maxBuffer` real: al superarlo se mata el árbol y se resuelve con error `ENOBUFS` (test que lo demuestre); en POSIX, liberar el grupo de procesos también ante `exit`/`SIGINT` del proceso padre; en Windows ignorar el código 128 de `taskkill` (proceso ya terminado) y usar `windowsHide`.
- **Paso 7, test sin carrera:** el script simulado imprime el pid del nieto; el test lo lee del `stdout` acumulado y espera a que aparezca (con margen amplio y reintentos) antes de que venza el tiempo, y comprueba que el nieto ha muerto con un bucle de reintentos sobre `process.kill(pid, 0)` (esperando `ESRCH`), no con un único sleep.
- **Paso 8 y documentación:** el tester revisa explícitamente las citas de los archivos movidos en `buenas-practicas-backend.md` (líneas ~30, 34, 109, 199 y 211), `mantenimiento.md:26`, `docs/03-configuracion.md:63`, `docs/05-modulos.md` (líneas ~113 y 126) y `docs/README.md:51-52`.
- Confirmado por el usuario: subir `MIN_TESTS` al recuento real no entra en la decisión pendiente (c), y la suite de `quality-check.mjs` pasa a ser asíncrona (top-level `await`, el script ya es `.mjs`).

## Tests que lo demuestran

- Existentes, sin debilitar: `tests/estructura-rutas.test.js`, `tests/rutas-protegidas.test.js`, `tests/jwt-algoritmo.test.js`, los de login y límite de intentos, `tests/errores-controlados`, `tests/app-importacion.test.js` y `tests/index-arranque.test.js`.
- Nuevos: capas con `middleware/` (paso 1) y `tests/controles-scripts.test.js` con `routesInIndex` (paso 6) y `runWithTimeout` (paso 7).

## A cargo del tester-documentador

- `docs/05-modulos.md`: la sección `tokenAuthentication.js` pasa a `middleware/`; se elimina la sección `userAuthentication.js` y su contenido se integra en la de `routes/auth.js` (`bcrypt.compare`, lecturas de entorno al cargar, `HS256`, `try/catch` y `next(error)`); sección de `middleware/` con `errorHandler`, `notFound` y `tokenAuth`. `docs:check` exige encabezado en docs/05 para toda ruta de `codeFiles` y que cada export se mencione (`userAuth` ya no se exporta).
- `docs/03-configuracion.md`: `userAuthentication.js` pasa a `routes/auth.js`. `docs/04-api.md`: comprobar que no cita las rutas antiguas. `docs/README.md`: el árbol quita los dos archivos de `functions/` y añade `middleware/tokenAuthentication.js`.
- Guías: `buenas-practicas-backend.md` (fila de `middleware/` a «Cumple»; «`middleware/` no importa `aws/`»; citas de `userAuthentication.js` a `routes/auth.js`; quitar la fila «Middleware fuera de `middleware/`» (B7)); `mantenimiento.md` (referencias a los archivos movidos; sección 3 con `index.js` sin rutas y la capa `middleware/`; nota de que `quality-check` mata el árbol de procesos al agotar los 180 s); `seguridad.md` (apartado de `scripts/` con (a) y (b)).
- `docs/07-estado-y-deuda-tecnica.md`: fecha; B7 resuelto; M24 (a) y (b) resueltos, (c) `MIN_TESTS` y (d) `npm audit` de la CI abiertos como decisión pendiente con las opciones de la spec; métricas (archivos de código −1, archivos de test +1, recuento de tests); «commit pendiente» como marcador del hash.
- Aviso de PR `docs/specs/2026-10-30-b7-m24-limpieza-estructura-y-controles-aviso-pr.md`: «sin cambio de contrato»; (por confirmar) con `sigmetum-infra` que ningún despliegue espera `uploads/`; (d) pendiente y `.github/workflows/ci.yml` sin cambios. Contrato con el frontend: revisar la sección 6 de `mantenimiento.md` y decir «no afecta».

## Por confirmar

- Que ningún despliegue espere la carpeta `uploads/`.
- Que `docsDeArea` resuelva bien `routes/auth.js` frente a `routes/**` (se comprueba con `npm run docs:gate`).
