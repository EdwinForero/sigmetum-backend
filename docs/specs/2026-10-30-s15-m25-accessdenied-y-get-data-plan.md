# S15 y M25: AccessDenied en el glosario y clave de GET /get-data: plan

Fecha: 2026-10-30 · Estado: cerrado · Spec: `docs/specs/2026-10-30-s15-m25-accessdenied-y-get-data-design.md`

Crítico: sí (entradas de `criticidad`: «claves de S3» por la lista de permitidos de `get-data`, y «contrato con el frontend» porque `routes/**` es área de contrato y cambian códigos 400 y 404). Además hay riesgo de pérdida de datos del glosario (A6). Sin veto. Sin rutas nuevas: `tests/estructura-rutas.test.js` no cambia (`GET /list-terms` y `GET /get-data/:path(*)` ya están como `public`).

## Decisiones de diseño

1. **Lectura frente a escritura del glosario.** Tercer parámetro opcional en `getTextJsonS3`: `getTextJsonS3(fileName, folderName, { vacioSiAccessDenied = false } = {})`. El valor por defecto es estricto: `uploadTextToJsonS3` y `deleteTermFromS3` llaman sin opción y no cambian, así que la protección contra la pérdida de datos (A6) no depende de recordar nada. Solo `GET /list-terms` pasa `{ vacioSiAccessDenied: true }`. Descartada una función nueva (duplicaría el parseo y la comprobación de array) y que la ruta capture el error (obligaría a duplicar el predicado en `routes/`).
2. **Dónde vive la regla de «archivo ausente».** En `aws/`, junto al `NoSuchKey` actual: es clasificación de códigos del SDK, no lógica de negocio. `aws/` no importa `functions/`; no hay importaciones nuevas en `aws/`, así que `tests/capas-importaciones.test.js` no cambia.
3. **Detección de AccessDenied.** `error.name === 'AccessDenied' || error.Code === 'AccessDenied'`, igual que `isNoSuchKey`. Comentario en `aws/` que enlaza con `errorHandler`; en `routes/data.js`, constante local `isAccessDenied` con el mismo criterio. No se toca `middleware/errorHandler.js` ni su `friendlyMessage` (con solo `name`, el 500 de escritura sale «Internal server error» en vez de «Access denied to storage»: sigue siendo 500 y sin `putObject`).
4. **`GET /get-data`.** Función pura nueva `isValidGetDataKey` en `functions/validateDataKey.js`: `isValidDataKey(key) || isValidActiveKey(key)`. `isValidActiveKey` no se exporta; pide cadena, longitud ≤ `DATA_KEY_MAX_LENGTH`, 3 segmentos, `${s0}/${s1} === ACTIVE_PATH`, último segmento acabado en `.json` y provincia (sin `.json`) con `getProvinciaNameError === null` y en NFC. La validación de provincia rechaza `.`, así que `x.json.json` y `..` quedan fuera; también rechaza `active*` y `terms*`. 400 `{ success: false, error: 'Invalid path' }` sin llamar a S3, dentro del `try` y antes de `getFileFromS3`. En el `catch`, si `isAccessDenied(error)`, `next(Object.assign(new Error('Object not accessible'), { status: 404, publicMessage: 'The requested file does not exist in storage' }))` (mismo patrón que `Draft not found`). `NoSuchKey` sigue por `errorHandler` (404); cualquier otro error, `next(error)`.
5. **Doble con estado.** `tests/helpers/s3-con-estado.js` puede lanzar `AccessDenied` por clave con `alEnviar(fn)` según `llamada.op` y `llamada.key` (`errorS3('AccessDenied', ..., 403)`); no hace falta tocarlo. Los tests van en `tests/s3-robustez.test.js` (SDK parcheado con `estado.get`) y `tests/claves-cliente.test.js` (simulados).

## Fase 1

1. **`isValidGetDataKey` (TDD: primero el test que falla)**
   - Archivos: `functions/validateDataKey.js` (modificar), `tests/claves-cliente.test.js` (modificar: importa la función y prueba la ruta).
   - Firma: nueva `isValidGetDataKey(key) => boolean`, añadida a `module.exports`; `isValidDataKey` e `isValidDraftKey` no cambian.
   - Comprobación, sobre `GET ${PREFIX}/get-data/<clave>` con `spyTotal() === 0`: 400 `{ success: false, error: 'Invalid path' }` con `data/../x`, `..%2f..%2fsecret`, `data/terms/noLatinTerms.json`, `data/drafts/Málaga/<uuid>.xlsx`, otra raíz (`x/active/Málaga.json`), clave de más de 120 caracteres, provincia inválida (cirílica y CGJ, siempre como secuencias de escape en el código de test, nunca el carácter crudo), provincia en NFD, `data/active/active.json`, `data/active/x.json.json` y `data/Málaga/x.json`. La clave vacía queda como caso a confirmar (`/get-data/` puede no llegar a la ruta). Unitarios: `data/Málaga/2026-10-28_v1.xlsx` y `data/active/Málaga.json` dan `true`.
   - Normas: `docs/guias/seguridad.md` (claves de S3 desde el cliente contra lista de permitidos, sin normalizar ni reescribir) y `docs/guias/buenas-practicas-backend.md`.

2. **Ruta `GET /get-data`: 400 y 404 con AccessDenied (TDD)**
   - Archivos: `routes/data.js`, `tests/s3-robustez.test.js` (describe B9), `tests/rutas-publicas.test.js` (fixture).
   - `GET /get-data/:path(*)` sin cambio de ruta ni de clasificación; importa `isValidGetDataKey`; constante local `isAccessDenied`.
   - Comprobación: en B9, `get-data con AccessDenied: 500` pasa a 404 con cuerpo exacto `{ success: false, error: 'The requested file does not exist in storage' }` (variantes `name`, `Code` y ambos); los otros tres casos de B9 (`NoSuchBucket`, red, `Foo`) siguen en 500. Regresión: `data/active/Sevilla.json` con `estado.get` devolviendo un array da 200 `{ success: true, data: [...] }` y `NoSuchKey` da 404. Límite documentado (caracterización): `data/Sevilla/2026-10-05_v1.xlsx` con un `.xlsx` real (`makeXlsx`) da 500 «Internal server error» por `SyntaxError` en `JSON.parse`, con un comentario que remite a frontend:D1 y M2.
   - **Aviso:** `tests/rutas-publicas.test.js` línea 11 usa `/get-data/data/malaga/x.json`, que hoy da 200 y con la lista de permitidos daría 400. Es un fixture de test, no una clave real (ningún activo ni listado del frontend tiene esa forma): cambiarlo a `/get-data/data/active/Malaga.json` y dejarlo anotado en el resumen (criterio 7 de la spec).
   - Normas: buenas prácticas (todo `async` con `try/catch` y `next(error)`; no devolver `err.message`); `para-frontend.md` (cambio compatible).

3. **`list-terms` con AccessDenied como `[]` (TDD)**
   - Archivos: `aws/awsS3connect.js` (`getTextJsonS3`), `routes/content.js` (`list-terms`), `tests/s3-robustez.test.js`.
   - `getTextJsonS3(fileName, folderName, { vacioSiAccessDenied = false } = {})`: en el `catch` devuelve `[]` si es `NoSuchKey`, o si es `AccessDenied` y la opción es `true`; el resto se relanza. `router.get('/list-terms')` llama a `getTextJsonS3(TERMS_FILE, TERMS_PATH, { vacioSiAccessDenied: true })`.
   - Comprobación: en el bucle `fallos` de «getTextJsonS3 y glosario», el test `GET /list-terms: 500` se salta para `AccessDenied`, que pasa a un describe nuevo. Con `AccessDenied` (`name`, `Code`, ambos): `GET /list-terms` da 200 `{ success: true, data: [] }` y `realAws.getTextJsonS3(..., { vacioSiAccessDenied: true })` da `[]`. El mismo `AccessDenied` con la opción por defecto sigue rechazando; los tests existentes `getTextJsonS3 rechaza`, `uploadTextToJsonS3 rechaza y no escribe` y `deleteTermFromS3 rechaza y no escribe` se mantienen. Con la opción en `true`, `NoSuchBucket`, red, 5xx, cuerpo no JSON, cuerpo vacío, `{}` y `null` siguen siendo 500 en `list-terms`. `tests/errores-controlados.test.js` usa el espía que ignora la opción y no debería cambiar.
   - Normas: buenas prácticas (fila «Distingue no existe de falló»); seguridad (no sobrescribir el glosario con un permiso roto).

4. **Protección de las escrituras (A6) y cierre de la suite**
   - Archivos: `tests/s3-robustez.test.js`, `scripts/quality-check.mjs` (`MIN_TESTS`).
   - Comprobación: `POST /upload-term` y `DELETE /delete-term` con `AccessDenied` en la lectura dan 500 con `{ success: false, error: 'Access denied to storage' }` (name y Code) y `puts().length === 0`; con solo `name` o solo `Code`, 500 sin `putObject`; con `NoSuchKey` el alta sigue creando el glosario (`PutObject` con `[{ term }]`). La aserción del texto `Access denied to storage` para `upload-term` es nueva (B5 ya cubre `delete-term`). Ejecutar `npm test`; `MIN_TESTS` al número real medido (no el estimado); `npm run lint` y `npm run quality`.
   - Normas: seguridad; `CLAUDE.md` (subir `MIN_TESTS` al añadir tests).

## A cargo del tester-documentador

- `docs/04-api.md`: `GET /get-data` (lista de permitidos; 400 `Invalid path` sin llamar a S3; 404 con `NoSuchKey` y con `AccessDenied`; los `.xlsx` siguen en 500 por `JSON.parse`, D1); `GET /list-terms` (200 `[]` con `NoSuchKey` y con `AccessDenied`); `upload-term` y `delete-term` sin cambio (500 `Access denied to storage`).
- `docs/05-modulos.md`: `getTextJsonS3` con la opción `vacioSiAccessDenied` (por defecto estricto), `isValidGetDataKey`, `isAccessDenied` local en `routes/data.js` y la nota de detección equivalente entre `aws/` y `errorHandler`. `docs/06-almacenamiento-s3.md`: qué lecturas toleran `AccessDenied` y cuáles no; permisos necesarios (`GetObject`, `PutObject`, `DeleteObject` y `ListBucket` con `Prefix` en `gallery/` y `data/`).
- `docs/03-configuracion.md`: `ALLOWED_ORIGIN` en plural, lista separada por comas (`app.js:30` divide por `,`, recorta y compara de forma exacta).
- `docs/integracion/para-infra.md`: corregir la fila «Un único origen exacto» y la sección 5 si lo repite; estado de infra:S15 (resuelto en el backend para `list-terms`, no para las altas); mitigación temporal (subir `[]` a `data/terms/noLatinTerms.json` en dev y prod: necesaria para dar de alta el primer término, no para `get-data`); sustituir las notas «(por confirmar) `s3:ListBucket`» de A6, A2/A9 y B5/B9 por el estado nuevo; orden de despliegue (backend antes del apply) y, como **(por confirmar)**, qué código devuelve S3 en dev para una clave inexistente con la política nueva.
- `docs/integracion/para-frontend.md`: filas de `GET /get-data` y `GET /list-terms` y F1; fila nueva de cambio compatible (la siguiente libre tras F16: comprobarlo en el archivo); las claves reales de `FileDropdown` (`data/<provincia>/<nombre>.xlsx`) siguen pasando la lista de permitidos.
- `docs/guias/seguridad.md` (lista de permitidos de `get-data` y riesgo aceptado de `AccessDenied` como 404 o `[]`), `docs/guias/buenas-practicas-backend.md` (fila «Distingue no existe de falló»), `docs/guias/mantenimiento.md` (secciones 2 y 6).
- `docs/07-estado-y-deuda-tecnica.md`: M25 resuelto; S15 anotado; M2 abierto (primer paso hecho); A6 con el riesgo residual (`list-terms` oculta un permiso roto); riesgo nuevo (`get-data` con `AccessDenied` da 404); métricas y fecha; «commit pendiente» como marcador del hash.
- Aviso de PR `docs/specs/2026-10-30-s15-m25-accessdenied-y-get-data-aviso-pr.md`: claves malformadas de `get-data` pasan de 500 a 400; despliegue del backend antes del apply de infra; mitigación `[]` en `noLatinTerms.json`; `ALLOWED_ORIGIN` es una lista; los `.xlsx` siguen en 500 (D1). Cierre: lint, quality, docs:check, npm test y docs:gate.

## Ajustes aprobados tras la segunda opinión (obligatorios para el developer)

- **Paso 2:** el 404 de `get-data` conserva la causa: `new Error('Object not accessible', { cause: error })` (con `status: 404` y el `publicMessage` fijo), para que el log distinga un permiso roto (`getFileFromS3` ya registra con `console.error`). Cerrar el punto de la clave vacía: `/get-data/` llega a la ruta con una cadena vacía y da 400 con la regla (test que lo fije).
- **Paso 3:** comentario en `aws/` de que `vacioSiAccessDenied` es solo para lecturas; nunca pasarlo en una ruta que escribe.
- **Paso 4:** el test de `upload-term` con `AccessDenied` solo en `name` afirma «Internal server error» (500, sin `putObject`), no el texto de AccessDenied, porque `errorHandler` solo mira `Code`.
- **Paso 1 (TDD):** si los unitarios de `isValidGetDataKey` fallan por `TypeError: not a function`, añadir antes un stub que devuelva `false` para que el rojo sea de aserción. Los tests de regresión (activo con array da 200, NoSuchKey 404, AccessDenied con la opción por defecto rechaza) ya pasan hoy y no son rojos: decirlo en el informe.
- **Documentación (tester):** aviso de PR y `para-frontend.md`: `GET /list-files` devuelve cualquier clave bajo `data/` que no sea carpeta reservada, aunque no cumpla `AAAA-MM-DD_vN.xlsx` ni la regla de provincia (archivos antiguos, `.json` sueltos); esas claves pasarían en `get-data` de 200 o 500 a 400 (límite del cambio de contrato; si existen en dev o prod, por confirmar). Actualizar `buenas-practicas-backend.md` (fila de AccessDenied en 500) y `seguridad.md` (textos mapeados). Anotar que la detección de AccessDenied está duplicada en tres sitios (aws/, routes/data.js y errorHandler) como deuda menor.

## Pruebas

- Modificadas: `tests/claves-cliente.test.js`, `tests/s3-robustez.test.js` (describes A6 y B9 y uno nuevo de `list-terms`), `tests/rutas-publicas.test.js` (fixture de `get-data`). `tests/capas-importaciones.test.js` debe seguir pasando.
- Comando: `node --test tests/s3-robustez.test.js tests/claves-cliente.test.js tests/rutas-publicas.test.js`; luego `npm test`, `npm run lint`, `npm run quality`.

## Por confirmar

- Qué código devuelve S3 en dev con la política nueva para una clave inexistente (infra).
- Quién sube `[]` a `data/terms/noLatinTerms.json` en dev y prod antes del apply.
