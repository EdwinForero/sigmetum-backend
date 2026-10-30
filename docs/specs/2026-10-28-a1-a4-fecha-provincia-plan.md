# A1 y A4: fecha UTC, provincia y claves de versión validadas: plan

Fecha: 2026-10-28 · Estado: cerrado · Spec: `docs/specs/2026-10-28-a1-a4-fecha-provincia-design.md`

Crítico: sí (claves de S3; contrato con el frontend). Segunda opinión sobre el plan: sin críticos; sus notas están en «Notas para el developer».

## Hechos del código que condicionan el plan

- `convertExcelToJson` omite la clave `Provincia` cuando la celda está vacía o solo tiene espacios. Una celda con coma da un array y una numérica un número: ambos son «no es una cadena» y dan 400.
- `processedData` conserva el valor original de las celdas. Solo la provincia usada como clave se recorta y se normaliza.
- `listFilesInS3Folder` es el único punto que llama a `listObjectsV2` con `Prefix`. Lo usan `getNextVersion`, `deleteFileFromS3` y `getMergedDataInS3Folder`. `GET /list-files` ya pasa `data/` con barra.
- `scripts/verificar-rutas.mjs` sustituye `aws/awsS3connect.js` por espías en `require.cache`; `uploadFileToS3`, `updateFileS3`, `deleteFileFromS3` y `listFilesInS3Folder` no guardan sus argumentos.
- `package.json` fija `engines.node` en 22 (`node:test` `mock.timers` con `Date` disponible).

## Decisiones que la spec dejó al plan

1. Longitud máxima de provincia 50 (`PROVINCIA_MAX_LENGTH`), medida sobre el valor ya recortado y en NFC y comprobada antes de la expresión.
2. `PROVINCIA_PATTERN = /^\p{L}[\p{L}\p{M}]*(?:[ -]\p{L}[\p{L}\p{M}]*)*$/u`: un solo espacio o guion entre palabras, siempre entre letras; rechaza `/`, `\`, `.`, dígitos y separadores en los extremos. `Alicante/Alacant` y `Castellón/Castelló` se rechazan por la barra.
3. `PROVINCIA_RESERVED = [...RESERVED_SEGMENTS, 'drafts']` (exacta, sin tocar `RESERVED_SEGMENTS`, para no cambiar `GET /list-files`). Además se rechaza lo que en `toLowerCase()` empiece por `active` o `terms`, y cualquier nombre de `Object.getOwnPropertyNames(Object.prototype)` más `prototype` (comparación exacta).
4. Varias provincias: la primera fila debe traer provincia válida; toda otra fila que traiga la clave `Provincia` debe ser, tras trim y NFC, `===` a la primera (otra cadena, array o número: 400). Las filas sin la clave se ignoran y siguen el flujo de `emptyFields` y borrador.
5. Prefijo con barra: se normaliza una sola vez dentro de `listFilesInS3Folder`; `getNextVersion` y `deleteFileFromS3` no cambian por ello.
6. `functions/validateDataKey.js` (`isValidDataKey`): cadena de máximo 120 caracteres; exactamente 3 segmentos al partir por `/`; el primero es `data`; el segundo pasa la regla de provincia más `s === s.normalize('NFC')` (sin reescribir); el tercero cumple `DATA_FILE_NAME_PATTERN = /^\d{4}-\d{2}-\d{2}_v\d+\.xlsx$/`. Fallo: 400 `Invalid draftKey` o `Invalid fileName`; antes se mantiene `... is required`.
7. `getNextVersion(provincia, now = new Date())` y `formatFileName(version = 1, now = new Date())`, ambas con `now.toISOString().slice(0, 10)`; la ruta crea un único `now` por petición.
8. Mensajes 400 de `POST /upload`: `Province is required`, `Province is not valid`, `Province is reserved`, `Excel contains more than one province`.

## Fase 1

1. **A1: fecha UTC compartida**
   - Archivos: `functions/getNextVersion.js`, `functions/formatFileName.js` (modificar). Quitar `getFullYear`, `getMonth`, `getDate`. Formato `AAAA-MM-DD_vN.xlsx` intacto.
   - Comprobación: criterio 11 (paso 6).
   - Contrato: `para-frontend.md` D2 (formato sin cambios; el día pasa a ser UTC). Ambos archivos están en `areasContrato`.

2. **Prefijo con barra en el listado (único cambio en `aws/`)**
   - Archivo: `aws/awsS3connect.js`, solo `listFilesInS3Folder`: `Prefix: folderName.endsWith('/') ? folderName : \`${folderName}/\``. Sin lógica de negocio nueva.
   - Efecto: `getNextVersion`, `deleteFileFromS3` y `getMergedDataInS3Folder('data/active')` dejan de ver `data/activos/...` o `data/Santa Cruz de Tenerife/...`.
   - Comprobación: criterio 15.

3. **Constantes y validadores**
   - `config/s3Paths.js` (modificar): `PROVINCIA_MAX_LENGTH`, `PROVINCIA_PATTERN`, `PROVINCIA_RESERVED`, `DATA_FILE_NAME_PATTERN`, con comentario al estilo de `IMAGE_KEY_*`, sin bandera `g`.
   - `functions/validateProvincia.js` (crear): `getProvinciaNameError(name)` (`null` o uno de los tres mensajes) y `validateProvincia(rows)` (`{ provincia }` o `{ error }`), con trim y NFC solo del valor leído del Excel. Orden: ausente o vacía en la primera fila; no cadena, longitud, patrón o propiedad de objeto; reservada o prefijo `active`/`terms`; otra fila distinta.
   - `functions/validateDataKey.js` (crear): `isValidDataKey(key)`, reutiliza `getProvinciaNameError` y la comprobación NFC. Sigue el patrón de `validateImageKey.js`.
   - Comprobación: criterios 12 y 14.

4. **`POST /upload`: provincia validada y fecha única**
   - Archivo: `routes/data.js`. Sustituir `processedData[0]?.['Provincia'] || 'Desconocido'` por `validateProvincia(processedData)`; con `error`, `400 { success: false, error }` antes de `getNextVersion` y de cualquier `uploadFileToS3`. `const now = new Date()` pasado a `getNextVersion` y `formatFileName`. La provincia normalizada va en `provinciaFolder`, `draftKey` y `data/active/{provincia}.json`.
   - Sin cambios en la respuesta de éxito ni en el 400 de `emptyFields`. `tokenAuth` sigue siendo el primer manejador.
   - Comprobación: criterio 13.

5. **Claves del cliente en `upload/confirm`, `update-file` y `delete-file`**
   - Archivo: `routes/data.js`. Tras el 400 de «required», `if (!isValidDataKey(...)) return res.status(400).json({ success: false, error: 'Invalid draftKey' })` (`'Invalid fileName'` en las otras dos). En `upload/confirm`, antes de la bifurcación `confirmed`. La clave nunca se normaliza ni se reescribe; una provincia en NFD da 400.
   - Comprobación: criterio 14.

## Fase 2

6. **Verificación repetible en `scripts/verificar-rutas.mjs`**
   - Ampliar los espías para guardar argumentos (`uploadFileToS3`, `updateFileS3`, `deleteFileFromS3`, `listFilesInS3Folder` con lista sembrada). Añadir los criterios 11 a 15, actualizar la lista de criterios vacíos (`[1..15]`) y la cabecera.
   - **11, fecha:** `formatFileName(1, new Date('2026-10-28T23:30:00Z'))` da `2026-10-28_v1.xlsx` y con `2026-10-29T00:30:00Z` da `2026-10-29_v1.xlsx`; `getNextVersion` con un listado que trae `2026-10-28_v1.xlsx` y `now` fijo da versión 2; el flujo de `POST /upload` usa el mismo día UTC en clave y versión.
   - **12, nombre de provincia (sin red):** válidas `Málaga`, `Santa Cruz de Tenerife`, `A Coruña`, `Illes Balears`; rechazadas `a/b`, `a\b`, `..`, `a1`, `__proto__`, `constructor`, `prototype`, `toString`, `active`, `terms`, `drafts`, `Activos`, `Terms2`, vacía, `  `, 51 letras, un número, un array; `' Málaga '` y la forma NFD resuelven a NFC recortada; `Málaga` y `Malaga` siguen distintas.
   - **13, `POST /upload`:** Excel en memoria con `exceljs`, multipart con token válido y `convertExcelToJson` real. Éxito: claves `data/{provincia}/...` y `data/active/{provincia}.json`. 400 sin llamadas a `uploadFileToS3`: provincia ausente, reservada, `__proto__`, con barra, numérica, con coma, dos provincias, primera fila sin provincia. Una fila posterior sin provincia se acepta y sigue el flujo de `emptyFields`; con celdas vacías el 400 de borrador conserva `data.draftKey`.
   - **14, claves del cliente (tres rutas):** válida `data/Málaga/2026-10-28_v1.xlsx` llega al espía con la clave exacta; 400 sin tocar S3 para `data/active/...`, `data/terms/x.xlsx`, `data/a/b/...`, `x/Málaga/...`, `data/Málaga/x.json`, `data/Málaga/../active/...`, provincia en NFD, más de 120 caracteres y valores no cadena; se mantienen los `... is required`.
   - **15, prefijos con barra sobre el `aws/` real:** cargar el módulo real, comprobar que el `Prefix` termina en `/` para `getMergedDataInS3Folder('data/active')` y que con `data/Santa Cruz` y `data/Santa Cruz de Tenerife` sembrados el listado de `Santa Cruz` solo ve los suyos (también el de `deleteFileFromS3`); `data/` no se duplica.
   - Comprobación: `node scripts/verificar-rutas.mjs` → «Resultado: todo pasa»; los criterios 1 a 10 siguen pasando; se repite con `TZ=Pacific/Kiritimati`.

## Notas para el developer (segunda opinión)

- **Criterio 15:** guardar el stub de `aws/awsS3connect.js` y de `functions/getNextVersion.js` en `require.cache`, borrar ambas entradas, cargar el real, probar y restaurar las dos en un `finally`. Ponerlo el último en `main`: `startApp` recarga `content.js` en cada llamada y, sin restaurar, los criterios 2-5 y 9-10 irían a la red. Parchear `S3Client.prototype.send` e inspeccionar `command.input.Prefix` (cubre también `ListObjectsV2Command` de la galería). Con `NODE_ENV=test`, `new S3` no pide credenciales.
- **Espías 11-15:** el criterio 6 exige `spyTotal()` sin cambios; los criterios nuevos miden deltas y corren después.
- **`mock.timers` con `Date`:** un `Date` simulado lejos de la hora real caduca el token de `tokenAuth`. Firmar el token con `expiresIn` largo, o simular el reloj solo en las llamadas directas a `getNextVersion`/`formatFileName`.
- **Patrón de fichero:** `getNextVersion.js` tiene su propio regex (línea ~12); reutilizar `DATA_FILE_NAME_PATTERN` de `s3Paths.js` si es un cambio mínimo y no altera el comportamiento; si no, dejarlo y decirlo. `v\d+` admite `_v0` y `_v007`.
- **Tope de 50:** se mide sobre el valor recortado y en NFC.
- **No tocar:** `GET /list-files`, `RESERVED_SEGMENTS`, el orden `localeCompare` de `deleteFileFromS3` (hallazgo nuevo, fuera de alcance) ni la paginación de `listObjectsV2` (M10).

## A cargo del tester-documentador

- `docs/07-estado-y-deuda-tecnica.md`: A1 y A4 resueltos con fecha de hoy; M4 cerrado solo para `upload/confirm`, `update-file` y `delete-file`, con lo que sigue abierto; límites (`Málaga`/`Malaga` y variantes de mayúsculas duplican carpetas; carpetas existentes en NFD o con nombres rechazados dejan de poder actualizarse o borrarse, por confirmar si existen; la carpeta usa la provincia normalizada pero `processedData` guarda el valor original de la celda; las filas sin `Provincia` quedan bajo la provincia de la primera fila); hallazgos nuevos (`localeCompare` con `_v10` antes que `_v9`; homoglifos no detectados); fecha «actualizado» y métricas al día. Los avisos `security/detect-object-injection` de `grouped[provincia]` no se retiran salvo que el lint lo demuestre.
- `docs/04-api.md`: los nuevos 400 de `POST /upload`, `/upload/confirm`, `/update-file` y `/delete-file`.
- `docs/05-modulos.md` y `docs/06-almacenamiento-s3.md`: fecha UTC; validadores y constantes nuevas; prefijo con barra en `listFilesInS3Folder`; rechazo de claves no NFC; provincia del Excel recortada y en NFC.
- `docs/guias/buenas-practicas-backend.md` (validación de entrada y claves de S3), `docs/guias/seguridad.md` (clave de versión) y `docs/guias/mantenimiento.md` (`scripts/**`: criterios 11 a 15).
- `docs/integracion/para-frontend.md`: D2 sin cambios; nuevos 400; día del nombre en UTC; condiciones de compatibilidad (claves salidas de `GET /list-files` o de `draftKey`; carpetas reales en NFC y que cumplan la regla); revisar la sección 6 de `mantenimiento.md`. `para-infra.md` no se ve afectado.
- Aviso para PR en `docs/specs/*-aviso-pr.md` (toca `areasContrato`): para el frontend (`FileDropdown`, `FileUpload`, por confirmar) y para quien gestione el bucket (carpetas en NFD o con nombre rechazado; posible carpeta `Desconocido`).
- Si bajan los avisos de ESLint, bajar `--max-warnings` al número real.

## Pruebas

- No hay base de tests (M11): la verificación son los criterios 11 a 15 de `scripts/verificar-rutas.mjs` (`npm run verificar:rutas`), con el huso por defecto y con `TZ=Pacific/Kiritimati` (UTC+14; con el código antiguo habría fallado).
- Después: `npm run lint`, `npm run quality`, `npm run docs:check`, `npm run docs:gate` (antes del commit). `agentes:test` no hace falta: no se toca `plugins/`.
- **(Por confirmar):** que `process.env.TZ` se respeta en Windows con Node 22 (si no, `mock.timers`); que `quality` no marque la expresión nueva como regex insegura (si lo hace, no se silencia: se informa); el camino con S3 real y las carpetas reales del bucket (dev y prod, incluidas las de NFD).
