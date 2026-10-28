# Módulos, funciones y métodos

Detalle de cada fichero del código. Para los endpoints desde el punto de vista del cliente, ver [04-api.md](04-api.md).

---

## `index.js` — punto de entrada

Orden de ejecución:

1. `require('dotenv').config()` — carga `.env`.
2. Registra `process.on('uncaughtException')` (log + `exit(1)`) y `process.on('unhandledRejection')` (sólo log).
3. `validateEnv()` — lanza si faltan variables; el proceso no arranca.
4. Crea la app Express y registra, en este orden:
   - `/healthcheck` (antes de todo lo demás)
   - `morgan('combined')`, `cors({ origin: ALLOWED_ORIGIN })`, `express.json()`, `compression()`
   - `authRoutes`, `dataRoutes`, `contentRoutes` bajo `API_PREFIX`
   - `errorHandler` (último)
5. `app.listen(PORT)`.

---

## `config/`

### `validateEnv.js`

| Elemento | Descripción |
|---|---|
| `required` | Array con las variables siempre obligatorias |
| `requiredLocal` | `['AWS_PROFILE']`, obligatorias sólo si `NODE_ENV === 'local'` |
| `validateEnv()` | Recorre ambas listas y lanza `Error("Variables de entorno requeridas no definidas: ...")` con todas las que falten |

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

---

## `routes/`

Todos los routers siguen el mismo patrón: un `router` con rutas públicas y un `protectedRouter` con `tokenAuth`, montado al final con `router.use(protectedRouter)`. Como se monta sin ruta propia, `tokenAuth` también se ejecuta para las peticiones que `data.js` no resuelve y que deberían llegar a `content.js` (M21 de [07](07-estado-y-deuda-tecnica.md)).

### `auth.js`

| Elemento | Descripción |
|---|---|
| `loginLimiter` | `rateLimit({ windowMs: 15 min, max: 10 })` con cabeceras estándar `RateLimit-*` |
| `POST /log` | `loginLimiter` → `userAuth` |
| `GET /auth` | `tokenAuth` → responde `Authorized` |

### `data.js`

| Elemento | Descripción |
|---|---|
| `upload` | Instancia `multer({ storage: memoryStorage() })` |
| `GET /list-files` | `listFilesInS3Folder('data/')`, agrupa por el segundo segmento de la clave descartando `RESERVED_SEGMENTS` |
| `GET /get-data/:path(*)` | `getFileFromS3(path)` |
| `GET /get-merged-data` | `getMergedDataInS3Folder(ACTIVE_PATH)` |
| `ALLOWED_XLSX_MIMES` | MIME aceptados en `/upload`: el de xlsx, `application/octet-stream` y vacío (el cliente manda el MIME; la extensión es la comprobación real) |
| `POST /upload` | Sin `req.file` → 400; extensión distinta de `.xlsx` o MIME fuera de `ALLOWED_XLSX_MIMES` → 400. Después `convertExcelToJson` → `getNextVersion` → `formatFileName` → `uploadFileToS3` (Excel) → si no hay vacíos, `uploadFileToS3` (JSON activo); si hay vacíos, 400 con `draftKey` |
| `POST /upload/confirm` | 400 si `draftKey` falta o no es cadena. `confirmed` falso → `deleteFileFromS3(draftKey)`; verdadero → `updateFileS3(draftKey)` |
| `POST /update-file` | 400 si `fileName` falta o no es cadena; `updateFileS3(fileName)` |
| `POST /delete-file` | 400 si `fileName` falta o no es cadena; `deleteFileFromS3(fileName)` |

### `content.js`

| Elemento | Descripción |
|---|---|
| `upload` | Instancia `multer` en memoria |
| `transporter` | `nodemailer.createTransport` contra `smtp.gmail.com:587` (`secure: false` → STARTTLS) con `EMAIL`/`EMAIL_PASSWORD` |
| `POST /send-email` | 400 si `username`, `email`, `subject` o `message` no son cadenas o están vacías tras `trim()`; si no, construye `mailOptions` (from/to = `EMAIL`, `replyTo` = email del usuario) y `transporter.sendMail` |
| `GET /list-images` | `getPresignedUrlsFromS3Folder(GALLERY_PATH)` |
| `GET /get-image` | 400 si `imageKey` falta, está vacío o no es cadena; si no, `getPresignedUrlFromS3(GALLERY_PATH, imageKey)` |
| `GET /list-terms` | `getTextJsonS3(TERMS_FILE, TERMS_PATH)` |
| `POST /upload-image` | 400 si falta el fichero o `title` no es cadena o está vacío. Sustituye espacios del `title` por `_`, añade la extensión del fichero original, `uploadImageToS3` |
| `DELETE /delete-image` | 400 si `imageKey` falta o no es cadena; `deleteImageFromS3`; si devuelve `success: false` responde 500 |
| `POST /upload-term` | 400 si `term` no es cadena o está vacío tras `trim()`; `uploadTextToJsonS3(term, ...)` |
| `DELETE /delete-term` | 400 si `term` falta, está vacío o no es cadena; `deleteTermFromS3`; si devuelve `success: false` responde 500 |

---

## `functions/`

### `userAuthentication.js` → `userAuth(req, res, next)`

Handler de login (no es middleware: solo llama a `next(error)` ante un fallo inesperado).

- Construye en memoria un array `users` con un único usuario `{ id: 1, username: ADMIN_USERNAME, password: ADMIN_PASSWORD }`.
- Todo el cuerpo va dentro de `try/catch`; un fallo inesperado llega a `errorHandler` con `next(error)`.
- Si `username` o `password` no son cadenas (ausentes, número, objeto, `null`) → 400 `Username and password are required and must be strings`.
- Busca por `username`; si no existe → 401.
- `bcrypt.compare(password, user.password)`; si falla → 401. **`ADMIN_PASSWORD` debe ser un hash bcrypt.**
- Firma `jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRATION })` y responde `{ token }`.

Las variables se leen al cargar el módulo, no en cada petición.

### `tokenAuthentication.js` → `tokenAuth(req, res, next)`

Middleware.

- Lee `Authorization`, toma lo que va tras el primer espacio (`Bearer <token>`).
- Sin token → 401 `No token provided`.
- `jwt.verify` con `JWT_SECRET`: error → 401 `Token expired` o `Invalid token`.
- Éxito → `req.user = payload` y `next()`.

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

### `formatFileName.js` → `formatFileName(version = 1)`

Devuelve `YYYY-MM-DD_v{version}.xlsx` con la **fecha local** del servidor.

### `getNextVersion.js` → `getNextVersion(provincia)`

Devuelve `Promise<{ version, provinciaFolder }>`.

- `provinciaFolder = data/{provincia}`.
- Lista la carpeta y, para los ficheros con patrón `YYYY-MM-DD_vN.xlsx` cuya fecha es **hoy (UTC)**, toma el mayor `N` y devuelve `N + 1`. Si no hay ninguno de hoy, `1`.

---

## `aws/awsS3connect.js`

Crea un único cliente `S3` (clase agregada de SDK v3) con `AWS_REGION` y, en local, credenciales `fromSSO`. Todas las funciones usan `process.env.AWS_BUCKET_NAME`.

### Helpers internos

| Función | Descripción |
|---|---|
| `streamToString(stream)` | Lee un stream de S3 a string UTF-8 |
| `streamToBuffer(stream)` | Lee un stream de S3 a `Buffer` |

### URLs prefirmadas

| Función | Parámetros | Devuelve | Notas |
|---|---|---|---|
| `getPresignedUrlsFromS3Folder` | `folderPath` | `[{ fileName, url }]` | `ListObjectsV2` + `getSignedUrl` por objeto, en paralelo. Expiran en 3600 s. **Lanza si la carpeta está vacía** |
| `getPresignedUrlFromS3` | `filePath, imageKey` | `string` | URL de `filePath/imageKey`, 3600 s. Envuelve el error en `Error('Error getting signed URL')` |

### Lectura

| Función | Parámetros | Devuelve | Notas |
|---|---|---|---|
| `getFileFromS3` | `filePath` | objeto JSON | `GetObject` + `JSON.parse`. Relanza errores |
| `getBufferFromS3` | `filePath` | `Buffer` | Para leer Excel |
| `getTextJsonS3` | `fileName, folderName` | array JSON | **Devuelve `[]` ante cualquier error** (fichero inexistente, permisos, red…) |

### Listado

| Función | Parámetros | Devuelve | Notas |
|---|---|---|---|
| `listFilesInS3Folder` | `folderName` (prefijo) | `[{ name, key }]` | Descarta objetos de tamaño 0 (marcadores de carpeta). Sin paginación: máximo 1000 objetos |
| `getMergedDataInS3Folder` | `folderName` | array | Lista y descarga cada JSON **en secuencia**, concatenando |

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
| `deleteFileFromS3` | `filePath` (`data/{prov}/{fecha}_vN.xlsx`) | `{ message }` | Borra la versión; si quedan `.xlsx` en la provincia, reconvierte el último (orden alfabético) y reescribe el activo; si no queda ninguno, borra el activo |

### Versión activa

| Función | Parámetros | Notas |
|---|---|---|
| `updateFileS3` | `filePath` (`data/{prov}/{fecha}_vN.xlsx`) | Descarga el Excel, lo convierte y sobreescribe `data/active/{prov}.json` |

---

## `middleware/errorHandler.js`

| Elemento | Descripción |
|---|---|
| `isDev` | `NODE_ENV === 'local'` |
| `friendlyMessage(err)` | Mapea `err.name` / `err.code` / `err.Code` a mensajes legibles (tabla en [04-api.md](04-api.md#errores-comunes)) |
| `errorHandler(err, req, res, next)` | Status = `err.status \|\| err.statusCode`, o 400 si `err.name === 'MulterError'`, o 500. En local loguea el stack; en otros entornos sólo el mensaje. Responde `{ success: false, error }` |
