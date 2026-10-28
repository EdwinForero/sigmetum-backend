# Referencia de la API

Todas las rutas van bajo `API_PREFIX` (por defecto `/api/v1`), salvo `/healthcheck`.

- 🔓 = pública · 🔒 = requiere `Authorization: Bearer <token>`
- Respuesta de éxito: `{ "success": true, "data": ... }`
- Respuesta de error: `{ "success": false, "error": "mensaje" }`
- **Aviso (M21 de [07](07-estado-y-deuda-tecnica.md))**: el código contradice la columna 🔓 de `POST /send-email`, `GET /list-images`, `GET /get-image` y `GET /list-terms`: `tokenAuth` se ejecuta antes de llegar a `content.js` y, sin token, responden `401 No token provided` (verificado con una petición real a un servidor local; en producción **por confirmar**). La columna refleja la intención, no el comportamiento. Por eso los `400` de `/send-email` y `/get-image` de más abajo solo se alcanzan hoy con un token válido.

## Resumen

| Método | Ruta | Acceso | Router |
|---|---|---|---|
| GET | `/healthcheck` | 🔓 | `index.js` |
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

El token lleva `{ userId }` y caduca según `JWT_EXPIRATION`.

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
Devuelve el JSON parseado del objeto con clave `:path` (admite `/`, p. ej. `/get-data/data/active/Malaga.json`).

### `GET /get-merged-data`
Concatena en un único array todos los JSON de `data/active/`. Es el endpoint que alimenta la vista pública de datos.

### `POST /upload` 🔒
`multipart/form-data` con campo `file` (Excel `.xlsx`).

Validación antes de procesar:
- Sin fichero → `400` `File is required`.
- Extensión distinta de `.xlsx` (sin distinguir mayúsculas; `.xls`, `.xlsm`, `.csv` y `.txt` entre ellas) → `400` `Only .xlsx files are allowed`, con cualquier MIME. En `/upload` el MIME no se comprueba (desde el 28/10/2026) porque lo manda el cliente; la extensión es la única comprobación de tipo. Un fichero que no es un libro válido pero se llama `.xlsx` llega a `convertExcelToJson` y responde `500` con el `err.message` de `exceljs` (M17), por ejemplo `Can't find end of central directory…` si no es un zip, o `Cannot read properties of undefined (reading 'eachRow')` si el libro está vacío. `/upload-image` sí sigue confiando en el MIME (M5).
- Campo multipart con otro nombre (`MulterError`, p. ej. `Unexpected field`) → `400` `File upload error: ...` (antes 500).

1. Convierte el Excel a JSON (`convertExcelToJson`).
2. Toma la provincia de la columna `Provincia` de la primera fila (`Desconocido` si no hay).
3. Calcula la versión del día y guarda el Excel original en `data/{provincia}/{YYYY-MM-DD}_v{n}.xlsx`.
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
- `400` `draftKey is required` si falta `draftKey` o no es una cadena (antes, un objeto daba 500). La clave no se valida contra una lista de permitidos (M4).

### `POST /update-file` 🔒
Body: `{ "fileName": "data/Malaga/2026-01-10_v1.xlsx" }` — marca esa versión como la activa de su provincia (rollback/roll-forward). `400` `fileName is required` si falta o no es una cadena (antes 500). La clave no se valida con la forma `data/{provincia}/AAAA-MM-DD_vN.xlsx` (M4).

### `POST /delete-file` 🔒
Body: `{ "fileName": "data/Malaga/2026-01-10_v1.xlsx" }` — borra esa versión. Si quedan otras, activa la más reciente por nombre; si no queda ninguna, borra también el JSON activo de la provincia. `400` `fileName is required` si falta o no es una cadena (antes 500); la clave no se valida con la forma de versión (M4).

---

## Contenido (`routes/content.js`)

### `POST /send-email`
Body: `{ "username", "email", "subject", "message" }`. Envía un correo desde y hacia `EMAIL`, con `replyTo` al email del usuario y asunto `"{subject} - enviado por {username}<{email}>"`.

`400` `username, email, subject and message are required and must be strings` si falta alguno de los cuatro, no es una cadena o está vacío tras quitar espacios; no se envía correo (antes se enviaba con "undefined"). No se valida el formato del email ni las longitudes, ni hay límite de peticiones (M3). Ver el aviso M21 de arriba.

### `GET /list-images`
Devuelve todas las imágenes de `gallery/` con URL prefirmada (válida 1 hora):
```json
{ "success": true, "data": [ { "fileName": "Encinar.jpg", "url": "https://..." } ] }
```

### `GET /get-image?imageKey=Encinar.jpg`
`data: { imageUrl }` — URL prefirmada (1 hora) de una imagen concreta. `400` `imageKey is required` si falta, está vacío o no es una cadena (por ejemplo `?imageKey=a&imageKey=b`); antes respondía `200` con una URL a `gallery/undefined`. La clave se sigue construyendo con texto del cliente sin lista de permitidos (M4, M5). Ver el aviso M21 de arriba.

### `GET /list-terms`
Devuelve el glosario `data/terms/noLatinTerms.json`: `[ { "term": "..." } ]`. Si no existe devuelve `[]`.

### `POST /upload-image` 🔒
`multipart/form-data` con `file` y `title`. Guarda en `gallery/{title_con_guiones_bajos}{extensión}`. `400` `File and title are required` si falta el fichero o `title` no es una cadena o está vacío (antes, un `title` no cadena daba 500). Un campo multipart con nombre incorrecto da `400` `File upload error: ...` (antes 500).

### `DELETE /delete-image` 🔒
Body: `{ "imageKey": "Encinar.jpg" }`. `400` `imageKey is required` si falta o no es una cadena.

### `POST /upload-term` 🔒
Body: `{ "term": "texto" }`. Añade el término al glosario. `400` `Term must be a string` si falta o no es una cadena (antes 500); `400` `Term cannot be empty` si está vacío o solo tiene espacios.

### `DELETE /delete-term` 🔒
Body: `{ "term": "texto" }`. Elimina todas las entradas con ese texto exacto. `400` `Term is required` si falta, está vacío o no es una cadena.

---

## Errores comunes

`middleware/errorHandler.js` traduce excepciones conocidas:

| Origen | Mensaje devuelto |
|---|---|
| `TokenExpiredError` | `Token expired` |
| `JsonWebTokenError` | `Invalid token` |
| `MulterError` | `File upload error: ...` |
| S3 `NoSuchKey` | `The requested file does not exist in storage` |
| S3 `NoSuchBucket` | `Storage bucket is not configured correctly` |
| S3 `AccessDenied` | `Access denied to storage` |
| `NetworkingError` / `ECONNREFUSED` | `Storage connection error` |
| Otro | `err.message` o `Internal server error` |

El status es `err.status || err.statusCode`, o `400` si el error es un `MulterError` (antes caía en 500), o `500`.
