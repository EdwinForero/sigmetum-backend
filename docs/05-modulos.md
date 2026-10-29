# Módulos, funciones y métodos

Detalle de cada fichero del código. Para los endpoints desde el punto de vista del cliente, ver [04-api.md](04-api.md).

---

## `index.js` — punto de entrada

Orden de ejecución:

1. `require('dotenv').config()` — carga `.env`.
2. Registra `process.on('uncaughtException')` (log + `exit(1)`) y `process.on('unhandledRejection')` (sólo log).
3. `validateEnv()` — lanza si faltan variables; el proceso no arranca.
4. `require('./app')` — después de validar, porque `aws/awsS3connect.js` lee `AWS_REGION` al cargarse.
5. `app.listen(PORT)`.

---

## `app.js` — la aplicación Express

Construye y exporta la app (`module.exports = app`) sin abrir puerto, sin `dotenv` y sin `validateEnv`, de modo que los tests la importan con `supertest` (M13 resuelto). Registra, en este orden:
   - `/healthcheck` (antes de todo lo demás)
   - `morgan('combined')`, `cors({ origin: ALLOWED_ORIGIN })`, `express.json()`, `compression()`
   - `authRoutes`, `dataRoutes`, `contentRoutes` bajo `API_PREFIX`
   - `notFound` (tras los tres routers)
   - `errorHandler` (último)

`trust proxy` vale 1 (ALB → nginx → Express). El 403 de CORS (`originNotAllowed`) vive aquí.

---

## `config/`

### `validateEnv.js`

| Elemento | Descripción |
|---|---|
| `required` | Array con las variables siempre obligatorias |
| `requiredLocal` | `['AWS_PROFILE']`, obligatorias sólo si `NODE_ENV === 'local'` |
| `validateEnv()` | Recorre ambas listas y lanza `Error("Variables de entorno requeridas no definidas: ...")` con todas las que falten. Después valida el valor de las presentes (M15): `ADMIN_PASSWORD` hash bcrypt completo, `JWT_SECRET` de al menos 32 caracteres y `JWT_EXPIRATION` con unidad y mayor que cero (`isValidExpiration`: rechaza solo números y duraciones <= 0, y delega el formato en `jsonwebtoken`). Si `NODE_ENV` no es exactamente `local` ni `test` lanza `Error("Variables de entorno con valor no válido: ...")`; en `local` y `test` solo emite `console.warn` con prefijo `[validateEnv]`. Los mensajes nombran variable y regla, nunca el valor. Detalle en [03](03-configuracion.md#variables-de-entorno) |

Exporta: `validateEnv` (función por defecto).

### `s3Paths.js`

| Constante | Valor | Uso |
|---|---|---|
| `GALLERY_PATH` | `gallery` | Imágenes de la galería |
| `DATA_PATH` | `data` | Raíz de las versiones Excel por provincia |
| `ACTIVE_PATH` | `data/active` | JSON activos, uno por provincia |
| `TERMS_PATH` | `data/terms` | Carpeta del glosario |
| `TERMS_FILE` | `noLatinTerms.json` | Fichero del glosario |
| `RESERVED_SEGMENTS` | `['active', 'terms']` | Subcarpetas de `data/` que no son provincias |
| `PROVINCIA_MAX_LENGTH` | `50` | Longitud máxima de la provincia, medida tras recortar y normalizar a NFC y comprobada antes de ejecutar la expresión |
| `PROVINCIA_WORD_PATTERN` | `/^\p{L}[\p{L}\p{M}]*$/u` (sin `g`) | Una palabra de provincia: letras Unicode con marcas combinantes. No es un patrón de la provincia entera: `getProvinciaNameError` parte por espacio o guion y valida cada palabra (una parte vacía = separador en los extremos o doble = rechazo) |
| `PROVINCIA_RESERVED` | `[...RESERVED_SEGMENTS, 'drafts']` | Nombres exactos que no pueden ser carpeta de provincia. `RESERVED_SEGMENTS` no cambia, para no alterar `GET /list-files` |
| `DATA_FILE_NAME_PATTERN` | `/^(\d{4}-\d{2}-\d{2})_v(\d+)\.xlsx$/` (sin `g`, dos grupos de captura: fecha y `N`) | Nombre de una versión (D2). Fuente única: `parseVersionName` (`functions/versionName.js`) lo usa para interpretar el nombre, y con él `getNextVersion` y `deleteFileFromS3`; `isValidDataKey` solo lo usa con `.test()` |
| `IMAGE_KEY_MAX_LENGTH` | `200` | Longitud máxima de un `imageKey` |
| `IMAGE_KEY_PATTERN` | expresión regular (banderas `u` e `i`, sin `g`) | Forma permitida de un `imageKey`; se aplica con `isValidImageKey` (regla en [06](06-almacenamiento-s3.md#regla-de-imagekey)). Va en forma plana, con dos lookaheads (`(?!.*\/\/)` y `(?!.*\/[.\p{M}])`, que impide que un segmento tras `/` empiece por `.` o por una marca combinante), para no disparar `security/detect-unsafe-regex` |

---

## `routes/`

Todos los routers declaran sus rutas en un único `router`. `tokenAuth` es el **primer manejador de cada ruta protegida**, en la propia línea de la declaración (`router.post('/upload', tokenAuth, upload.single('file'), ...)`, antes de `multer`); las públicas no lo llevan. No hay `router.use(tokenAuth)` a nivel de router, así que la protección no depende del orden de montaje en `app.js` (M21, entrega 2, ver [07](07-estado-y-deuda-tecnica.md)). `npm run quality` lo vigila con la suite de `tests/` (pila real de `app.js`: `tests/estructura-rutas.test.js` y `tests/rutas-protegidas.test.js`) y con `scripts/lib/repo.mjs`: `routeDeclarations()` lee las declaraciones de una línea y `unparsedRouteLines()` lista las líneas de `routes/` que parecen una declaración (`router.`/`protectedRouter.`/`app.` con `get|post|put|patch|delete|all|use|route(`) y no casan con el patrón completo, p. ej. partidas en varias líneas; `quality` las cuenta como problema. La suite monta la `app.js` real, con S3 y SMTP simulados.

### `auth.js`

| Elemento | Descripción |
|---|---|
| `loginLimiter` | `rateLimit({ windowMs: 15 min, limit: 10 })` con cabeceras estándar `RateLimit-*` |
| `POST /log` | `loginLimiter` → `userAuth` |
| `GET /auth` | `tokenAuth` → responde `Authorized` |

### `data.js`

| Elemento | Descripción |
|---|---|
| `upload` | Instancia `multer({ storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES + 1 } })` con `MAX_UPLOAD_BYTES` = 10 MB. Se suma 1 porque multer rechaza el tamaño igual a `fileSize`: así 10 MB exactos se aceptan y 10 MB + 1 byte da `LIMIT_FILE_SIZE` (400) |
| `GET /list-files` | `listFilesInS3Folder('data/')`, agrupa por el segundo segmento de la clave descartando `RESERVED_SEGMENTS` |
| `GET /get-data/:path(*)` | `getFileFromS3(path)` |
| `GET /get-merged-data` | `getMergedDataInS3Folder(ACTIVE_PATH)` |
| `POST /upload` | Sin `req.file` → 400; extensión distinta de `.xlsx` → 400 (el MIME no se comprueba en esta ruta: lo manda el cliente). Después `convertExcelToJson` → `validateProvincia(processedData)` (400 con su mensaje, antes de cualquier escritura) → un único `now = new Date()` pasado a `getNextVersion(provincia, now)` y `formatFileName(version, now)` → `uploadFileToS3` (Excel) → si no hay vacíos, `uploadFileToS3` (JSON activo); si hay vacíos, 400 con `draftKey` |
| `POST /upload/confirm` | 400 si `draftKey` falta o no es cadena; 400 `Invalid draftKey` si `isValidDataKey` la rechaza. `confirmed` falso → `deleteFileFromS3(draftKey)`; verdadero → `updateFileS3(draftKey)` |
| `POST /update-file` | 400 si `fileName` falta o no es cadena; 400 `Invalid fileName` si `isValidDataKey` la rechaza; `updateFileS3(fileName)` |
| `POST /delete-file` | 400 si `fileName` falta o no es cadena; 400 `Invalid fileName` si `isValidDataKey` la rechaza; `deleteFileFromS3(fileName)` |

### `content.js`

| Elemento | Descripción |
|---|---|
| `upload` | Instancia `multer` en memoria con `limits.fileSize` = 5 MB + 1 (mismo motivo que en `data.js`): 5 MB exactos se aceptan y 5 MB + 1 byte da 400 |
| `transporter` | `nodemailer.createTransport` contra `smtp.gmail.com:587` (`secure: false` → STARTTLS) con `EMAIL`/`EMAIL_PASSWORD` |
| `sendEmailLimiter` | `rateLimit({ windowMs: 15 min, limit: 5 })` con cabeceras estándar; al superarlo responde 429 con `{ success: false, error }`. Almacén en memoria (se reinicia al reiniciar y se multiplica por instancia). Copia de `loginLimiter`; los dos usan `limit` (B6 resuelto) |
| `POST /send-email` | `sendEmailLimiter` → `validateContactMessage(req.body)`; si devuelve `error`, 400; si no, construye `mailOptions` con los valores recortados (from/to = `EMAIL`, `replyTo` = email del usuario) y `transporter.sendMail`. Todo el cuerpo va dentro de `try/catch` con `next(error)`. Ruta pública (sin `tokenAuth`). El limitador es el primer manejador, cuenta antes de validar y cuenta también el tráfico anónimo |
| `GET /list-images` | `getPresignedUrlsFromS3Folder(GALLERY_PATH)` |
| `GET /get-image` | 400 si `imageKey` falta, está vacío o no es cadena; 400 `imageKey is not valid` si `isValidImageKey` lo rechaza; si no, `getPresignedUrlFromS3(GALLERY_PATH, imageKey)` |
| `GET /list-terms` | `getTextJsonS3(TERMS_FILE, TERMS_PATH)` |
| `POST /upload-image` | 400 si falta el fichero o `title` no es cadena o está vacío. Sustituye espacios del `title` por `_`, añade la extensión del fichero original, `uploadImageToS3` |
| `DELETE /delete-image` | 400 si `imageKey` falta o no es cadena; 400 `imageKey is not valid` si `isValidImageKey` lo rechaza; `deleteImageFromS3`; si devuelve `success: false` responde 500 (`next(new Error(result.error || 'delete-image failed'))`: el registro conserva un mensaje por defecto si `aws/` lo devuelve vacío) |
| `POST /upload-term` | 400 si `term` no es cadena o está vacío tras `trim()`; `uploadTextToJsonS3(term, ...)` |
| `DELETE /delete-term` | 400 si `term` falta, está vacío o no es cadena; `deleteTermFromS3`; si devuelve `success: false` responde 500 (`next(new Error(result.message || 'delete-term failed'))`, con el mismo mensaje por defecto en el registro) |

---

## `functions/`

### `userAuthentication.js` → `userAuth(req, res, next)`

Handler de login (no es middleware: solo llama a `next(error)` ante un fallo inesperado).

- Construye en memoria un array `users` con un único usuario `{ id: 1, username: ADMIN_USERNAME, password: ADMIN_PASSWORD }`.
- Todo el cuerpo va dentro de `try/catch`; un fallo inesperado llega a `errorHandler` con `next(error)`.
- Si `username` o `password` no son cadenas (ausentes, número, objeto, `null`) → 400 `Username and password are required and must be strings`.
- Busca por `username`; si no existe → 401.
- `bcrypt.compare(password, user.password)`; si falla → 401. **`ADMIN_PASSWORD` debe ser un hash bcrypt.**
- Firma `jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRATION, algorithm: 'HS256' })` y responde `{ token }`.

Las variables se leen al cargar el módulo, no en cada petición.

### `tokenAuthentication.js` → `tokenAuth(req, res, next)`

Middleware.

- Lee `Authorization`, toma lo que va tras el primer espacio (`Bearer <token>`).
- Sin token → 401 `No token provided`.
- `jwt.verify` con `JWT_SECRET`: error → 401 `Token expired` o `Invalid token`.
- Éxito → `req.user = payload` y `next()`.
- `jwt.verify` fija `algorithms: ['HS256']` (B8): un token firmado con otro algoritmo o con `alg: none` da 401 `Invalid token`; los emitidos antes siguen valiendo porque `jsonwebtoken` firma con HS256 por defecto.

### `validateImageKey.js` → `isValidImageKey(key)`

Función pura (no lee el entorno ni llama a S3) que decide si un `imageKey` del cliente puede usarse para construir la clave `gallery/{imageKey}`. Devuelve `true` solo si `key` es una cadena, mide entre 1 y `IMAGE_KEY_MAX_LENGTH` (comprobación previa a ejecutar la expresión), cumple `IMAGE_KEY_PATTERN` y no contiene `..`. La comprobación de `..` es defensa en profundidad: `a../b.jpg` (lo que llega tras decodificar `a%2e%2e/b.jpg`) cumple el patrón. La usan `GET /get-image` y `DELETE /delete-image`. Regla completa: [06](06-almacenamiento-s3.md#regla-de-imagekey).

### `validateProvincia.js` → `getProvinciaNameError(name)` y `validateProvincia(rows)`

Funciones puras (no leen el entorno ni llaman a S3). `getProvinciaNameError(name)` recibe un nombre ya recortado y en NFC y devuelve `null` o un texto fijo, en este orden: `Province is required` (ausente, `null` o `''`); `Province is not valid` (no cadena, más de `PROVINCIA_MAX_LENGTH`, alguna palabra que no cumple `PROVINCIA_WORD_PATTERN` tras partir por espacio o guion, o un nombre de `Object.getOwnPropertyNames(Object.prototype)` y `prototype`, como `constructor` o `toString`); `Province is reserved` (en `PROVINCIA_RESERVED` o, en minúsculas, empieza por `active` o `terms`). `validateProvincia(rows)` aplica trim y NFC solo al valor de la celda `Provincia` de la primera fila, devuelve `{ provincia }` o `{ error }` y, si otra fila trae la clave `Provincia` con un valor distinto (tras trim y NFC, `!==`), devuelve `Excel contains more than one province`. Las filas sin la clave se ignoran. La usa `POST /upload`. Regla: [06](06-almacenamiento-s3.md#regla-de-provincia).

### `validateDataKey.js` → `isValidDataKey(key)`

Función pura que decide si una clave del cliente (`draftKey`, `fileName`) puede usarse tal cual. `true` solo si es una cadena de hasta 120 caracteres, al partir por `/` da exactamente tres segmentos, el primero es `data`, el segundo pasa `getProvinciaNameError` y además `=== normalize('NFC')` (la clave no se reescribe), y el tercero cumple `DATA_FILE_NAME_PATTERN`. La usan `POST /upload/confirm`, `POST /update-file` y `POST /delete-file`. Regla: [06](06-almacenamiento-s3.md#regla-de-clave-de-versión).

### `validateContactMessage.js` → `validateContactMessage(body)`

Función pura que valida el cuerpo de `POST /send-email` (`body` puede ser `undefined`). Devuelve `{ error }` con un texto fijo en inglés que nombra el campo y la regla, sin reflejar el valor recibido, o `{ value: { username, email, subject, message } }` con los cuatro campos recortados. Reglas, en este orden: los cuatro son cadenas no vacías tras `trim()`; `username` ≤ 100, `subject` ≤ 150, `message` ≤ 2000 y `email` ≤ 254 caracteres (tras recortar); sin ningún carácter de control (`\p{Cc}`: `\r`, `\n`, NUL...) ni U+2028/U+2029 en `username`, `email` ni `subject` (error `username, email and subject must not contain control characters or line breaks`); `message` rechaza `\p{Cc}` salvo `\n`, `\r` y `\t` (error `message must not contain control characters`); `email` pasa una comprobación básica de formato, no un análisis RFC 5322: `^[^\s@,;:<>()'"\\]+@[^\s@,;:<>()'"\\]+\.[^\s@,;:<>()'"\\]+$`. **Límite conocido**: se rechaza un correo con apóstrofo (`o'brien@example.com`), válido en RFC pero poco habitual; si preocupa, **(por confirmar)**. Los límites son constantes del propio archivo.

### `convertExcelToJson.js` → `convertExcelToJson(input)`

| Parámetro | Tipo | Descripción |
|---|---|---|
| `input` | `Buffer` o `string` | Buffer del Excel o ruta a fichero |

Devuelve `Promise<{ processedData, emptyFields }>`.

Comportamiento:

- Lee sólo la **primera hoja**; la fila 1 es la cabecera y se ignora.
- Las columnas se leen **por posición**, no por nombre de cabecera, según `fixedColumnOrder`:

  | # | Columna |
  |---|---|
  | 1 | Provincia |
  | 2 | Municipio |
  | 3 | Altitud Media |
  | 4 | Sector Biogeográfico |
  | 5 | Piso Bioclimático |
  | 6 | Ombrotipo |
  | 7 | Naturaleza del Sustrato |
  | 8 | Tipo de Serie |
  | 9 | Serie de Vegetación |
  | 10 | Vegetación Potencial |
  | 11 | Especies Características |

- Valores con coma se convierten en array (`"Quercus, Pistacia"` → `["Quercus", "Pistacia"]`).
- Celdas vacías no se incluyen en el objeto de la fila; la fila se añade a `emptyFields` como `{ rowIndex, rowData }` pero **también** se incluye en `processedData`.

Helper interno `getCellValue(cell)`: normaliza celdas de ExcelJS — texto enriquecido (`richText`) se concatena, fórmulas devuelven su `result`, `null`/`undefined` → `null`.

### `formatFileName.js` → `formatFileName(version = 1, now = new Date())`

Devuelve `YYYY-MM-DD_v{version}.xlsx` con el día **UTC** de `now` (`now.toISOString().slice(0, 10)`; A1 resuelto el 28/10/2026). `now` se inyecta para poder fijar la fecha; la ruta pasa el mismo `now` a `getNextVersion`.

### `getNextVersion.js` → `getNextVersion(provincia, now = new Date())`

Devuelve `Promise<{ version, provinciaFolder }>`.

- `provinciaFolder = data/{provincia}`.
- Lista la carpeta y, para los ficheros con patrón `YYYY-MM-DD_vN.xlsx` (interpretado con `parseVersionName`) cuya fecha es **hoy (UTC, el día de `now`)**, toma el mayor `N` (entero: `_v9` y `_v10` dan `_v11`) y devuelve `N + 1`. Si no hay ninguno de hoy, `1`.

### `versionName.js` → `parseVersionName(name)` y `latestVersionFile(files)`

Funciones puras (no leen el entorno ni llaman a S3); interpretación única del nombre de una versión (A8, 29/10/2026). Está en `functions/` y no en `aws/` para que `aws/` la importe sin dependencia circular con `getNextVersion`.

- `parseVersionName(name)`: aplica `DATA_FILE_NAME_PATTERN` y devuelve `{ date, version }` (`version` como entero) o `null` si el nombre no es estándar.
- `latestVersionFile(files)`: recibe `[{ name, key }]` y devuelve el de mayor fecha y, a igual fecha, mayor `N` entero (`_v10` gana a `_v9`). Si también coincide `N` (`_v7` y `_v007`), gana el nombre mayor por unidades de código (`a.name > b.name`, no `localeCompare`), así el resultado no depende del orden del listado. Ignora los nombres no estándar y devuelve `null` si no hay ninguno estándar. La usa `deleteFileFromS3`.

---

## `aws/awsS3connect.js`

Crea un único cliente `S3` (clase agregada de SDK v3) con `AWS_REGION` y, en local, credenciales `fromSSO`. Todas las funciones usan `process.env.AWS_BUCKET_NAME`.

### Helpers internos

| Función | Descripción |
|---|---|
| `streamToString(stream)` | Lee un stream de S3 a string UTF-8 |
| `streamToBuffer(stream)` | Lee un stream de S3 a `Buffer` |
| `isRealObject(item)` | «Objeto real» de un listado: clave sin `/` final y `Size > 0` (excluye el marcador de carpeta y los objetos vacíos). Lo comparten `listFilesInS3Folder` y `getPresignedUrlsFromS3Folder`, de modo que no pueden divergir |
| `listAllObjects(prefix)` | `Contents` de **todas** las páginas de `ListObjectsV2`, sin tope de páginas. Una página sin `Contents` aporta `[]` y continúa. Guardia contra bucle infinito: lanza si `IsTruncated` es verdadero y falta `NextContinuationToken`, o si el token ya se usó |

### URLs prefirmadas

| Función | Parámetros | Devuelve | Notas |
|---|---|---|---|
| `getPresignedUrlsFromS3Folder` | `folderPath` | `[{ fileName, url }]` | `listAllObjects` + `getSignedUrl` por objeto real, en paralelo. Expiran en 3600 s. Devuelve `[]` con la carpeta vacía, ausente o con solo marcadores (A5; ya no lanza); un error real de `ListObjectsV2` sigue lanzando |
| `getPresignedUrlFromS3` | `filePath, imageKey` | `string` | URL de `filePath/imageKey`, 3600 s. Envuelve el error en `Error('Error getting signed URL')` |

### Lectura

| Función | Parámetros | Devuelve | Notas |
|---|---|---|---|
| `getFileFromS3` | `filePath` | objeto JSON | `GetObject` + `JSON.parse`. Relanza errores |
| `getBufferFromS3` | `filePath` | `Buffer` | Para leer Excel |
| `getTextJsonS3` | `fileName, folderName` | array JSON | Devuelve `[]` **solo** con `NoSuchKey` (por `error.name` o `error.Code`; un 404 sin más no basta, `NoSuchBucket` también lo es). Un JSON que no es un array lanza un `Error` sin `Code`; permisos, red, 5xx, `SyntaxError` y el cuerpo de 0 bytes se propagan (A6, 29/10/2026). `uploadTextToJsonS3` y `deleteTermFromS3` no llegan al `putObject` en esos casos |

### Listado

| Función | Parámetros | Devuelve | Notas |
|---|---|---|---|
| `listFilesInS3Folder` | `folderName` (prefijo) | `[{ name, key }]` | El `Prefix` del listado termina siempre en `/` (se añade si falta, sin duplicarlo): `data/Santa Cruz` no ve `data/Santa Cruz de Tenerife/` y `data/active` no ve `data/activos/` (también para `getNextVersion`, `deleteFileFromS3` y `getMergedDataInS3Folder`). Descarta los objetos que no son «reales» (`isRealObject`: clave acabada en `/` o tamaño 0). Recorre todas las páginas con `listAllObjects` (M10: ya no se trunca a 1000 objetos). Formato `{ name, key }` sin cambios |
| `getMergedDataInS3Folder` | `folderName` | array | Lista y lee los JSON **en paralelo** (`Promise.all`, M7; sin límite de concurrencia) y concatena en el orden del listado, no en el de finalización. Si una lectura falla, rechaza sin datos parciales |

### Escritura

| Función | Parámetros | Notas |
|---|---|---|
| `uploadFileToS3` | `fileName, body, folderName` | `PutObject` en `folderName/fileName`, sin `ContentType` |
| `uploadImageToS3` | `file, filePath, fileKey` | Usa `file.buffer` y `file.mimetype` de multer |
| `uploadTextToJsonS3` | `newText, fileName, folderName` | Lee el JSON, hace `push({ term })`, reescribe (read-modify-write) |

### Borrado

| Función | Parámetros | Devuelve | Notas |
|---|---|---|---|
| `deleteImageFromS3` | `filePath, imageKey` | `{ success, error? }` | No lanza; devuelve el error |
| `deleteTermFromS3` | `termToDelete, fileName, folderName` | `{ success, message? }` | Filtra el término y reescribe el fichero. No lanza |
| `deleteFileFromS3` | `filePath` (`data/{prov}/{fecha}_vN.xlsx`) | `{ message }` | Borra la versión, lista las que quedan y elige con `latestVersionFile` (fecha y luego `N` entero; A8 resuelto). Tres casos: (a) hay algún `.xlsx` con nombre estándar, reconvierte el más reciente y reescribe el activo (los de nombre no estándar se ignoran); (b) solo quedan `.xlsx` no estándar, **no toca el activo** (ni borra ni escribe); (c) no queda ningún `.xlsx` (la comprobación es sensible a mayúsculas), borra el activo. Sigue decidiendo en `aws/` (M14 y B5 abiertos), ahora apoyada en una función pura de `functions/` |

### Versión activa

| Función | Parámetros | Notas |
|---|---|---|
| `updateFileS3` | `filePath` (`data/{prov}/{fecha}_vN.xlsx`) | Descarga el Excel, lo convierte y sobreescribe `data/active/{prov}.json` |

---

## `middleware/notFound.js`

| Elemento | Descripción |
|---|---|
| `notFound(req, res)` | Responde `404` con `{ success: false, error: 'Not found' }`. Texto fijo: no lee ni refleja ruta, método ni consulta, y no escribe nada en consola (`morgan` sigue registrando la petición). No pasa por `errorHandler` ni usa `next`. Se exporta con `module.exports = notFound` |

Se monta con `app.use(notFound)` después de los tres routers y antes de `errorHandler`: atiende toda petición que ningún router resolvió, incluidas las de fuera de `API_PREFIX`. Un error de CORS (`Origin` no permitido) no llega aquí: lo para antes `cors` y sale por `errorHandler`.

---

## `middleware/errorHandler.js`

| Elemento | Descripción |
|---|---|
| `isDev` | `NODE_ENV === 'local'` |
| `friendlyMessage(err, status)` | Texto que ve el cliente, por este orden: `err.publicMessage`; mapeados por `err.name` / `err.code` / `err.Code` (`TokenExpiredError`, `JsonWebTokenError`, `MulterError`, `NoSuchKey`, `NoSuchBucket`, `AccessDenied`, `NetworkingError` / `ECONNREFUSED`); `File exceeds the maximum allowed size` (`MulterError` con `LIMIT_FILE_SIZE`, antes de la línea genérica `File upload error: ...` del resto de `MulterError`); `Invalid JSON` (`err.type === 'entity.parse.failed'`); `Payload too large` (413); `Bad request` (resto de 4xx, con guarda `400 <= status < 500`); y `Internal server error` para todo lo demás. Ya no devuelve `err.message` (M17). Tabla en [04-api.md](04-api.md#errores-comunes) |
| `errorHandler(err, req, res, next)` | Status = `err.status \|\| err.statusCode`, o 400 si `err.name === 'MulterError'`, o 500. En local loguea el stack; en otros entornos sólo el mensaje (el real, que no se envía al cliente). Responde `{ success: false, error }` |

**CORS en `index.js`.** El callback de `origin` de `cors` rechaza un origen no permitido con `console.warn('CORS: origin not allowed:', JSON.stringify(origin.slice(0, 200)))` (el origen se trunca a 200 caracteres antes de registrarlo, para que un `Origin` enorme no llene el registro, y `JSON.stringify` neutraliza saltos de línea y comillas de un valor que controla el cliente) y pasa a `cors` un único `Error` constante, `originNotAllowed` (`status = 403`, `publicMessage = 'Origin not allowed'`), creado fuera del callback porque ni `cors` ni `errorHandler` lo mutan (su traza es la del arranque); `errorHandler` lo responde como `403` `Origin not allowed`, sin el origen. El origen solo está en el `warn`.
