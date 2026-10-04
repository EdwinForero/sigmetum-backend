# Referencia de la API

Todas las rutas van bajo `API_PREFIX` (por defecto `/api/v1`), salvo `/healthcheck`.

- 🔓 = pública · 🔒 = requiere `Authorization: Bearer <token>`
- Respuesta de éxito: `{ "success": true, "data": ... }`
- Respuesta de error: `{ "success": false, "error": "mensaje" }`

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
- `401` → `Invalid credentials`
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
- `400` si falta `draftKey`.

### `POST /update-file` 🔒
Body: `{ "fileName": "data/Malaga/2026-01-10_v1.xlsx" }` — marca esa versión como la activa de su provincia (rollback/roll-forward).

### `POST /delete-file` 🔒
Body: `{ "fileName": "data/Malaga/2026-01-10_v1.xlsx" }` — borra esa versión. Si quedan otras, activa la más reciente por nombre; si no queda ninguna, borra también el JSON activo de la provincia.

---

## Contenido (`routes/content.js`)

### `POST /send-email`
Body: `{ "username", "email", "subject", "message" }`. Envía un correo desde y hacia `EMAIL`, con `replyTo` al email del usuario y asunto `"{subject} - enviado por {username}<{email}>"`.

### `GET /list-images`
Devuelve todas las imágenes de `gallery/` con URL prefirmada (válida 1 hora):
```json
{ "success": true, "data": [ { "fileName": "Encinar.jpg", "url": "https://..." } ] }
```

### `GET /get-image?imageKey=Encinar.jpg`
`data: { imageUrl }` — URL prefirmada (1 hora) de una imagen concreta.

### `GET /list-terms`
Devuelve el glosario `data/terms/noLatinTerms.json`: `[ { "term": "..." } ]`. Si no existe devuelve `[]`.

### `POST /upload-image` 🔒
`multipart/form-data` con `file` y `title`. Guarda en `gallery/{title_con_guiones_bajos}{extensión}`. `400` si falta alguno.

### `DELETE /delete-image` 🔒
Body: `{ "imageKey": "Encinar.jpg" }`. `400` si falta.

### `POST /upload-term` 🔒
Body: `{ "term": "texto" }`. Añade el término al glosario. `400` si está vacío.

### `DELETE /delete-term` 🔒
Body: `{ "term": "texto" }`. Elimina todas las entradas con ese texto exacto. `400` si falta.

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

El status es `err.status || err.statusCode || 500`.
