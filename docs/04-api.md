# Referencia de la API

Todas las rutas van bajo `API_PREFIX` (por defecto `/api/v1`), salvo `/healthcheck`.

- 🔓 = pública · 🔒 = requiere `Authorization: Bearer <token>`
- Respuesta de éxito: `{ "success": true, "data": ... }`
- Respuesta de error: `{ "success": false, "error": "mensaje" }`
- Las rutas 🔓 se alcanzan **sin** cabecera `Authorization` y la ignoran: con un token inválido o caducado responden igual que sin token. Las rutas 🔒 llevan `tokenAuth` como primer manejador de la propia ruta y responden `401` sin token (`No token provided`), con token inválido (`Invalid token`) o caducado (`Token expired`) (M21, entrega 2, 28/10/2026; ver [07](07-estado-y-deuda-tecnica.md)).
- **Rutas inexistentes y métodos no definidos** (M21, entrega 3, 28/10/2026): una ruta que ningún router resuelve (`GET /api/v1/no-existe`, también fuera del prefijo: `GET /`, `GET /otra`) o un método no definido en una ruta existente (`DELETE /list-terms`, `HEAD` incluido) responde `404` con `{ "success": false, "error": "Not found" }`, texto fijo que no refleja la ruta, el método ni la consulta, con o sin token (los ignora). No hay `405` ni cabecera `Allow`. `/healthcheck` queda a salvo (`200 ok`, texto). Un `Origin` no permitido sigue dando el error de CORS por `errorHandler`, no el 404.
- **Recurso ausente en S3** (B9, 29/10/2026): cualquier `NoSuchKey` de S3 que llegue a `errorHandler` responde `404` `{ "success": false, "error": "The requested file does not exist in storage" }`, texto fijo distinto de `Not found` (ruta inexistente): así el cliente distingue «recurso» de «ruta». Caso normal: `GET /get-data/:path`, `POST /update-file` y `POST /upload/confirm` al confirmar. Solo en carrera (el objeto desaparece entre el listado y la lectura): `GET /get-merged-data`, `POST /delete-file` y `POST /upload/confirm` al cancelar. No cambian: `DELETE /delete-image` y `POST /delete-file` de una clave inexistente (`200`, `DeleteObject` es idempotente), `GET /get-image` (`200`, solo firma la URL) y las rutas del glosario (`200`, A6).

## Resumen

| Método | Ruta | Acceso | Router |
|---|---|---|---|
| GET | `/healthcheck` | 🔓 | `app.js` |
| POST | `/log` | 🔓 (rate limit) | `auth.js` |
| GET | `/auth` | 🔒 | `auth.js` |
| GET | `/list-files` | 🔓 | `data.js` |
| GET | `/get-data/:path` | 🔓 | `data.js` |
| GET | `/get-merged-data` | 🔓 | `data.js` |
| POST | `/upload` | 🔒 | `data.js` |
| POST | `/upload/confirm` | 🔒 | `data.js` |
| POST | `/update-file` | 🔒 | `data.js` |
| POST | `/delete-file` | 🔒 | `data.js` |
| POST | `/send-email` | 🔓 | `content.js` |
| GET | `/list-images` | 🔓 | `content.js` |
| GET | `/get-image` | 🔓 | `content.js` |
| GET | `/list-terms` | 🔓 | `content.js` |
| POST | `/upload-image` | 🔒 | `content.js` |
| DELETE | `/delete-image` | 🔒 | `content.js` |
| POST | `/upload-term` | 🔒 | `content.js` |
| DELETE | `/delete-term` | 🔒 | `content.js` |

---

## Sistema

### `GET /healthcheck`
Responde `200 ok` en texto plano. Lo usa el health check del balanceador.

---

## Autenticación (`routes/auth.js`)

### `POST /log`
Login del administrador. Limitado a **10 intentos cada 15 minutos por IP**.

Body:
```json
{ "username": "admin", "password": "secreto" }
```
Respuestas:
- `200` → `{ success: true, data: { token } }`
- `400` → `Username and password are required and must be strings` (falta `username` o `password`, o no es una cadena; antes la petición se quedaba sin respuesta)
- `401` → `Invalid credentials` (cadenas válidas, usuario o contraseña incorrectos; una cadena vacía también da 401)
- `429` → `Too many login attempts. Please try again in 15 minutes.`

El token lleva `{ userId }`, se firma con HS256 (el algoritmo va fijado al firmar y `tokenAuth` solo acepta HS256; un token con otro algoritmo, como HS512, o con `alg: none` da `401` `Invalid token`) y caduca según `JWT_EXPIRATION`.

### `GET /auth` 🔒
Comprueba que el token es válido. `200` → `data: "Authorized"`; `401` → `No token provided` / `Token expired` / `Invalid token`.

---

## Datos de series de vegetación (`routes/data.js`)

Ver el modelo de almacenamiento en [06-almacenamiento-s3.md](06-almacenamiento-s3.md).

### `GET /list-files`
Lista todas las versiones Excel agrupadas por provincia (excluye `active/` y `terms/`).
```json
{ "success": true, "data": {
  "Malaga": [ { "name": "2026-01-15_v1.xlsx", "key": "data/Malaga/2026-01-15_v1.xlsx" } ]
} }
```

### `GET /get-data/:path`
Devuelve el JSON parseado del objeto con clave `:path` (admite `/`, p. ej. `/get-data/data/active/Malaga.json`). Con una clave inexistente responde `404` `The requested file does not exist in storage` (B9, 29/10/2026; antes `500`).

### `GET /get-merged-data`
Concatena en un único array todos los JSON de `data/active/`. Es el endpoint que alimenta la vista pública de datos.

### `POST /upload` 🔒
`multipart/form-data` con campo `file` (Excel `.xlsx`).

Validación antes de procesar:
- Sin fichero → `400` `File is required`.
- Extensión distinta de `.xlsx` (sin distinguir mayúsculas; `.xls`, `.xlsm`, `.csv` y `.txt` entre ellas) → `400` `Only .xlsx files are allowed`, con cualquier MIME. En `/upload` el MIME no se comprueba (desde el 28/10/2026) porque lo manda el cliente; la extensión es la única comprobación de tipo. Un fichero que no es un libro válido pero se llama `.xlsx` llega a `convertExcelToJson` y responde `500` `Internal server error` (el `err.message` de `exceljs`, por ejemplo `Can't find end of central directory…` si no es un zip o `Cannot read properties of undefined (reading 'eachRow')` si el libro está vacío, solo se registra en consola; M17 resuelto el 28/10/2026). `/upload-image` sí sigue confiando en el MIME (M5).
- Fichero de más de **10 MB** → `400` `File exceeds the maximum allowed size` (texto fijo, sin cifras; sin llamar a S3). El máximo aceptado es exacto: 10 MB justos se aceptan y 10 MB + 1 byte se rechazan (M6).
- Campo multipart con otro nombre (`MulterError`, p. ej. `Unexpected field`) → `400` `File upload error: ...` (antes 500).

1. Convierte el Excel a JSON (`convertExcelToJson`).
2. Toma la provincia de la columna `Provincia` de la primera fila, la recorta y la normaliza a NFC, y la valida (`validateProvincia`, regla en [06](06-almacenamiento-s3.md#regla-de-provincia)). Desde el 28/10/2026 ya no existe el valor `Desconocido`: una provincia ausente o inválida da `400` y no se escribe nada en S3 (A4). Respuestas `400` `{ success: false, error }` con texto fijo:
   - `Province is required`: primera fila sin `Provincia`, vacía o solo espacios.
   - `Province is not valid`: no es una cadena (número, array por una coma), mide más de 50 caracteres tras recortar, tiene algo distinto de letras (con acentos) separadas por un solo espacio o guion (`/`, `\`, `.`, dígitos, separadores en los extremos o dobles) o es un nombre de propiedad de objeto (`__proto__`, `constructor`, `toString`, `prototype`...).
   - `Province is reserved`: es `active`, `terms` o `drafts` exactos, o en minúsculas empieza por `active` o `terms` (`Activeness`, `Termsx`). `Activos` **se acepta**: la colisión con `data/active/` la evita el prefijo con barra de los listados.
   - `Excel contains more than one province`: otra fila que trae `Provincia` difiere de la primera (tras recortar y NFC, comparación exacta). Las filas sin la clave `Provincia` se ignoran y siguen el flujo de celdas vacías, bajo la provincia de la primera fila.
3. Calcula la versión del día (UTC) y guarda el Excel original en `data/{provincia}/{YYYY-MM-DD}_v{n}.xlsx`; la versión y el nombre usan el mismo instante de la petición.
4. Si **no** hay celdas vacías → escribe `data/active/{provincia}.json` y responde `200`:
   ```json
   { "success": true, "data": { "message": "Files uploaded successfully", "key": "data/Malaga/2026-01-15_v1.xlsx" } }
   ```
5. Si **hay** celdas vacías → el Excel queda guardado como borrador, **no** se activa, y responde `400`:
   ```json
   { "success": false, "error": "Some rows have empty fields.", "data": {
     "emptyFields": [ { "rowIndex": 7, "rowData": [ ... ] } ],
     "processedData": [ ... ],
     "draftKey": "data/Malaga/2026-01-15_v2.xlsx",
     "actionRequired": "Confirm whether to continue or cancel the upload."
   } }
   ```
   El frontend debe llamar después a `/upload/confirm`.

### `POST /upload/confirm` 🔒
Body: `{ "draftKey": "data/Malaga/2026-01-15_v2.xlsx", "confirmed": true }`

- `confirmed: true` → activa el borrador (regenera `data/active/{provincia}.json` desde ese Excel).
- `confirmed: false` → borra el borrador (y recalcula el activo con la última versión restante).
- `400` `draftKey is required` si falta `draftKey` o no es una cadena (antes, un objeto daba 500).
- `400` `Invalid draftKey` si la clave no cumple `data/{provincia}/AAAA-MM-DD_vN.xlsx` (regla de provincia, tres segmentos, máximo 120 caracteres, [06](06-almacenamiento-s3.md#regla-de-clave-de-versión)); se comprueba antes de la bifurcación `confirmed` y sin tocar S3. La clave nunca se normaliza: una provincia en NFD da 400 (M4 cerrado para esta ruta).

### `POST /update-file` 🔒
Body: `{ "fileName": "data/Malaga/2026-01-10_v1.xlsx" }` — marca esa versión como la activa de su provincia (rollback/roll-forward). `400` `fileName is required` si falta o no es una cadena (antes 500); `400` `Invalid fileName` si no cumple `data/{provincia}/AAAA-MM-DD_vN.xlsx` ([regla](06-almacenamiento-s3.md#regla-de-clave-de-versión); sin normalizar, provincia no NFC = 400; no toca S3). Que el objeto exista no se comprueba.

### `POST /delete-file` 🔒
Body: `{ "fileName": "data/Malaga/2026-01-10_v1.xlsx" }` — borra esa versión. Si quedan otras, activa la más reciente por nombre; si no queda ninguna, borra también el JSON activo de la provincia. `400` `fileName is required` si falta o no es una cadena (antes 500); `400` `Invalid fileName` si no cumple la forma de versión (misma regla que `/update-file`, no toca S3).

---

## Contenido (`routes/content.js`)

### `POST /send-email`
Body: `{ "username", "email", "subject", "message" }`. Envía un correo desde y hacia `EMAIL`, con `replyTo` al email del usuario y asunto `"{subject} - enviado por {username}<{email}>"`.

Límite: **5 peticiones cada 15 minutos por IP** (`express-rate-limit`, almacén en memoria; también cuentan las peticiones con cuerpo inválido). Respuestas:
- `200` → `data: "Email sent successfully."`
- `400` → `username, email, subject and message are required and must be strings` si falta alguno de los cuatro, no es una cadena o está vacío tras quitar espacios (antes se enviaba con "undefined").
- `400` → mensaje fijo que nombra el campo y la regla, sin reflejar el valor recibido: `username must be at most 100 characters`, `subject must be at most 150 characters`, `message must be at most 2000 characters`, `email must be at most 254 characters` (medidos tras recortar), `username, email and subject must not contain control characters or line breaks` (cualquier carácter de control, U+2028 y U+2029), `message must not contain control characters` (se admiten `
`, `` y `	` en el mensaje) y `email is not valid` (comprobación básica de formato, no RFC: `algo@dominio.tld` sin espacios, comas, punto y coma, dos puntos, ángulos, paréntesis, comillas ni barra invertida, y con un punto en el dominio; `a@b` se rechaza aunque `type="email"` del navegador lo admita; también se rechaza un correo con apóstrofo como `o'brien@example.com`, válido en RFC pero poco habitual, **(por confirmar)** si preocupa).
- `429` → `Too many messages. Please try again in 15 minutes.` (envoltorio `{ success: false, error }`; no se envía correo).

Se guardan y se envían los valores recortados. En ningún `400` ni `429` se envía correo (M3 resuelto, ver [07](07-estado-y-deuda-tecnica.md)). Estos códigos (`200`, `400`, `429`, `500`) se alcanzan sin token desde la entrega 2 de M21; el límite cuenta también el tráfico anónimo.

### `GET /list-images`
Devuelve todas las imágenes de `gallery/` con URL prefirmada (válida 1 hora):
```json
{ "success": true, "data": [ { "fileName": "Encinar.jpg", "url": "https://..." } ] }
```
Con la galería vacía, o con solo el marcador de carpeta `gallery/`, responde `200` con `data: []` (A5/D5 resueltos el 29/10/2026; antes `500`, o el marcador como imagen de `fileName` vacío). Se excluyen las claves que terminan en `/` y los objetos de tamaño 0, y se recorren todas las páginas del listado. Un fallo real de S3 (por ejemplo `AccessDenied`) sigue dando `500` genérico.

### `GET /get-image?imageKey=Encinar.jpg`
`data: { imageUrl }` — URL prefirmada (1 hora) de una imagen concreta. `400` `imageKey is required` si falta, está vacío o no es una cadena (por ejemplo `?imageKey=a&imageKey=b`); antes respondía `200` con una URL a `gallery/undefined`. `400` `imageKey is not valid` si la clave no cumple la lista de permitidos compartida con `DELETE /delete-image` (regla en [06](06-almacenamiento-s3.md#regla-de-imagekey)), antes de llamar a S3. Se alcanza sin token (M21, entrega 2); firma cualquier clave bajo `gallery/` que cumpla la regla, exista o no en el listado.

### `GET /list-terms`
Devuelve el glosario `data/terms/noLatinTerms.json`: `[ { "term": "..." } ]`. Si no existe (`NoSuchKey`) devuelve `[]`. Ante cualquier otro fallo de S3 (permisos, red, 5xx), un glosario de 0 bytes, con JSON corrupto o con un JSON que no es un array, responde `500` genérico por `next(error)` (A6, 29/10/2026; antes `200` `[]`). Con `AccessDenied` el mensaje es `Access denied to storage`. **Efecto**: un glosario ilegible ya no se autocura y bloquea esta ruta, `POST /upload-term` y `DELETE /delete-term` hasta repararlo a mano en S3 (ver [06](06-almacenamiento-s3.md)).

### `POST /upload-image` 🔒
`multipart/form-data` con `file` y `title`. Guarda en `gallery/{título_saneado}.{extensión en minúsculas}` y responde `data: { key: "gallery/..." }`. `400` `File and title are required` si falta el fichero o `title` no es una cadena o está vacío (antes, un `title` no cadena daba 500).

Desde el 29/10/2026 (M5) valida el tipo, el título y el contenido, en este orden (el primero que falla decide), con textos fijos que no reflejan el MIME, el título ni el nombre del fichero, y sin llamar a S3:

1. `400` `Image type not allowed`: la extensión (en minúsculas) no es `jpg`, `jpeg`, `png`, `gif` ni `webp` (ni siquiera hay extensión), o el MIME declarado, en minúsculas, no es exactamente el de esa extensión (`image/jpeg` para `jpg` y `jpeg`, `image/png`, `image/gif`, `image/webp`). `image/jpg`, el MIME vacío y `application/octet-stream` dan 400. `.jfif`, `.jpe` y `.pjpeg` ya no se suben. Riesgo: un sistema operativo o navegador sin registro de tipo para `.webp` manda un MIME vacío y recibiría este 400 **(por confirmar)**; el MIME en mayúsculas (`IMAGE/JPEG`) se acepta, con un cliente real **(por confirmar)**.
2. `400` `Image title is not valid`: el título se sanea (recorte, cada tramo de blanco, incluidos `\t` y `\n`, pasa a `_`, y se quitan los puntos finales: `Fig.` da `Fig`). Se rechaza si queda vacío (también si solo eran puntos), si lleva `/`, `\` o `..`, si lleva un carácter de control que no es blanco (por ejemplo `\x00`), si lo saneado supera 200 caracteres o si la clave completa (título más extensión) no pasa `isValidImageKey` (máximo 200). La regla de lectura de `imageKey` no se ha tocado, así que un título con `,` `'` `:` `&` `#` `?` `%` (por ejemplo `Encinar, vista 1` o `Bosque d'Or`) también da 400. Tildes, ñ, mayúsculas y espacios se aceptan.
3. `400` `File content does not match the image type`: los primeros bytes del fichero no tienen la firma del tipo (JPEG, PNG, GIF o WebP) o el fichero es más corto que la firma (también vacío). Un polyglot imagen+script con cabecera válida pasa; la firma no sustituye un reprocesado de la imagen.

El backend fija el `ContentType` del objeto al MIME canónico del tipo validado, no al que manda el cliente. La extensión de la clave va siempre en minúsculas: `foto.JPG` y `foto.jpg` son la misma clave. No se normaliza a NFC: el mismo título en NFC y en NFD da claves distintas. Una clave ya existente se sobrescribe sin aviso (sin `409`). Un fichero de más de **5 MB** da `400` `File exceeds the maximum allowed size` (el máximo aceptado es exacto: 5 MB justos se aceptan y 5 MB + 1 byte se rechazan; sin llamar a S3). Un campo multipart con nombre incorrecto da `400` `File upload error: ...` (antes 500).

### `DELETE /delete-image` 🔒
Body: `{ "imageKey": "Encinar.jpg" }`. `400` `imageKey is required` si falta o no es una cadena; `400` `imageKey is not valid` si no cumple la lista de permitidos (misma regla que `GET /get-image`, ver [06](06-almacenamiento-s3.md#regla-de-imagekey)), sin llamar a S3. Con `AccessDenied`, `NoSuchBucket` o fallo de red responde `500` con los textos mapeados (ver [errores comunes](#errores-comunes); B5, 29/10/2026); con una clave inexistente responde `200` (`DeleteObject` es idempotente).

### `POST /upload-term` 🔒
Body: `{ "term": "texto" }`. Añade el término al glosario. `400` `Term must be a string` si falta o no es una cadena (antes 500); `400` `Term cannot be empty` si está vacío o solo tiene espacios. Con el glosario inexistente (`NoSuchKey`) lo crea con ese único término. Ante otro fallo de S3 o un glosario ilegible (0 bytes, JSON corrupto o no-array) responde `500` sin escribir nada (no sobrescribe el glosario; A6); con `AccessDenied`, `Access denied to storage`.

### `DELETE /delete-term` 🔒
Body: `{ "term": "texto" }`. Elimina todas las entradas con ese texto exacto. `400` `Term is required` si falta, está vacío o no es una cadena. Ante un fallo de S3 distinto de `NoSuchKey` o un glosario ilegible (0 bytes, JSON corrupto o no-array) responde `500` sin escribir nada (A6); con `AccessDenied`, `NoSuchBucket` o fallo de red responde `500` con los textos mapeados (`Access denied to storage`, `Storage bucket is not configured correctly`, `Storage connection error`; B5, 29/10/2026). Con S3 correcto, `200` `Term deleted successfully`.

---

## Errores comunes

`middleware/errorHandler.js` traduce excepciones conocidas:

| Origen | Mensaje devuelto |
|---|---|
| `TokenExpiredError` | `Token expired` |
| `JsonWebTokenError` | `Invalid token` |
| `MulterError` con código `LIMIT_FILE_SIZE` | `File exceeds the maximum allowed size` |
| Otros `MulterError` | `File upload error: ...` |
| S3 `NoSuchKey` (`name` o `Code`; responde `404`, B9) | `The requested file does not exist in storage` |
| S3 `NoSuchBucket` | `Storage bucket is not configured correctly` |
| S3 `AccessDenied` | `Access denied to storage` |
| `NetworkingError` / `ECONNREFUSED` | `Storage connection error` |
| JSON mal formado en el cuerpo (`err.type === 'entity.parse.failed'`, 400) | `Invalid JSON` |
| Cuerpo mayor que el límite de `express.json` (100 KB; 413) | `Payload too large` |
| Otro error de librería con estado 4xx (por ejemplo 415 o 422) | `Bad request` (límite conocido: se pierde el detalle de cualquier 4xx distinto de 413) |
| `Origin` no permitido por CORS (`app.js`; 403) | `Origin not allowed` |
| Cualquier otro error (sin `status`, 5xx, o con texto propio como `Excel conversion failed...`, `No files found...` o `Error getting signed URL`) | `Internal server error` |

El mensaje real de un error no mapeado **no se devuelve al cliente**: se registra en consola (`[método] ruta → estado` más `err.message`, o el stack en `local`). El orden de reglas de `friendlyMessage(err, status)` es: `publicMessage`, los mapeados de la tabla (por `name` o código), `Invalid JSON`, `Payload too large`, `Bad request` (guarda `400 <= status < 500`) y, si nada encaja, `Internal server error`. Las respuestas 4xx que las rutas construyen con `res.status(400).json(...)` no pasan por `errorHandler` y conservan su texto.

El status es `err.status || err.statusCode`, o `400` si el error es un `MulterError` (antes caía en 500), o `404` si es `NoSuchKey` (por `name` o `Code`; B9, 29/10/2026), o `500`. Un `status` o `statusCode` propio manda también sobre `NoSuchKey`. `NoSuchBucket`, `AccessDenied` y `NetworkingError` / `ECONNREFUSED` siguen respondiendo `500` con su texto. Límite conocido: un `code` en minúscula con valor `NoSuchKey` (sin `name` ni `Code`) da `500` con el texto mapeado; el SDK real no lo produce. Riesgo: un fallo de datos a mitad de operación se lee como «no existe» (en `POST /delete-file`, un `NoSuchKey` en la lectura posterior al borrado responde `404` aunque el borrado ocurrió). Notas: `code === 'ECONNREFUSED'` etiqueta también como `Storage connection error` un fallo de conexión SMTP de `nodemailer` (comportamiento existente), y `NetworkingError` es un nombre del SDK v2 de AWS; qué devuelve el SDK real en cada caso de almacenamiento solo se probó con errores inyectados **(por confirmar)**.

`DELETE /delete-image` y `DELETE /delete-term` no responden con el mensaje del SDK: `aws/` lanza el error original y `errorHandler` lo traduce como en el resto de rutas (B5, 29/10/2026; antes `500` `Internal server error` siempre): `AccessDenied` → `Access denied to storage`, `NoSuchBucket` → `Storage bucket is not configured correctly`, red → `Storage connection error`, sin código → `Internal server error`, todos con `500`. El detalle queda en la consola. `GET /list-images` con la galería vacía daba `500` (F3, A5); desde el 29/10/2026 responde `200` `data: []`.

**CORS rechazado.** Una petición con `Origin` distinto de `ALLOWED_ORIGIN` (también el preflight `OPTIONS`) responde `403` `{ "success": false, "error": "Origin not allowed" }`, sin el origen en el cuerpo (antes `500` con el origen reflejado, M22). El origen (truncado a 200 caracteres) se registra solo con `console.warn('CORS: origin not allowed:', JSON.stringify(origin.slice(0, 200)))`. Una petición sin `Origin` o con el origen permitido no cambia. Un navegador no deja a la página ver esta respuesta (no lleva `Access-Control-Allow-Origin`); solo la ven `curl`, herramientas y servidores.
