# Validación de entradas (A7 y A3): plan

Fecha: 2026-10-28 · Estado: cerrado · Spec: [2026-10-28-a7-a3-validacion-entradas-design.md](2026-10-28-a7-a3-validacion-entradas-design.md) (decisiones 1 a 9)

Crítico: sí. Coincide con "autenticación y JWT" (`functions/userAuthentication.js`) y con "contrato con el frontend" (`routes/**` y `middleware/errorHandler.js` cambian códigos de estado).

## Supuestos y decisiones

- Sin helper compartido. Comprobaciones en línea (`typeof x !== 'string'`); un módulo nuevo añadiría entrada en `docs/05-modulos.md` sin ahorrar código. Se descarta `functions/validateInput.js`.
- Sin dependencias nuevas.
- Express 4.21: un rechazo en un `async` sin `try/catch` no llega a `errorHandler`. Es la causa de A7: `bcrypt.compare(undefined, hash)` rechaza y `userAuth` (`functions/userAuthentication.js:17`) no captura.
- Orden en `userAuth`: primero el tipo (400), después el usuario (401). Cadena vacía sigue siendo 401.
- `send-email`: presencia y tipo; vacíos (`trim`) tratados como ausentes.
- MIME de `/upload` (decisión 6): la extensión `.xlsx` es la comprobación real. El MIME lo manda el cliente (`file.mimetype` de multer); se acepta uno de {MIME xlsx, `application/octet-stream`, `''`}. **(Por confirmar)**: si falta el `Content-Type` de la parte, busboy puede rellenar `text/plain` por defecto en vez de `''`, y ese cliente recibiría 400; se comprueba en el paso 3 y, si ocurre, se decide con el usuario antes de ampliar la lista.
- `MulterError` (decisión 8): se resuelve en un solo punto, `middleware/errorHandler.js`: status 400 cuando `err.name === 'MulterError'` y no hay `err.status`. Hoy acaba en 500 (línea 19); el mensaje "File upload error: ..." ya existe (línea 9). Alternativa descartada: envolver `upload.single('file')` en `data.js` y `content.js` (duplica código y no cubre rutas futuras). `errorHandler.js` está en `areasContrato`.
- M17 fuera de alcance (decisión 9): `errorHandler` sigue devolviendo `err.message` en 5xx.
- Mensajes en inglés, fijos, sin `err.message` interno.
- Fuera de alcance, señalado y no tocado:
  - `/get-image` (`aws/awsS3connect.js:69`) y `/delete-image` (`:209`) siguen construyendo la clave `GALLERY_PATH/${imageKey}` con texto del cliente sin lista de permitidos (M4/M5); aquí solo presencia y tipo.
  - `/upload/confirm` y `/delete-file` pasan `draftKey` y `fileName` a S3 con la misma limitación (M4).
  - `/delete-image` y `/delete-term` devuelven `result.error` y `result.message` en un 500 (`content.js:113` y `:146`): familia M17, no se toca.

## Fase 1 (datos, login y MulterError)

1. **`userAuth`: validar entrada y capturar errores (A7, criterios 1-3)**
   - Archivo: `functions/userAuthentication.js` (modificar).
   - Cambios: `async (req, res)` pasa a `async (req, res, next)`. Todo el cuerpo, incluida la desestructuración de `req.body`, dentro de `try { ... } catch (error) { next(error); }`. Al inicio: si `username` o `password` no son `string`, 400 `{ success: false, error: 'Username and password are required and must be strings' }`. El resto igual (401 `Invalid credentials`; `{ success: true, data: { token } }`).
   - Comprobación (`npm start`, `POST /api/v1/log`): sin `password`, o `123`, `{}`, `null` → 400 en menos de 1 s; `username` ausente o no cadena → 400; contraseña errónea → 401; correctas → 200 con `token`; sin `unhandledRejection` en el log.
   - Criterio 3, script puntual sin crear archivos: `node -e` que haga `require('./functions/userAuthentication').userAuth({}, resStub, e => console.log('next', e.name))`. Con `req = {}`, `req.body` es `undefined`, la desestructuración lanza dentro del `try` y debe verse `next TypeError`. Solo vale si la desestructuración queda dentro del `try`.
   - Cautela: `loginLimiter` (`routes/auth.js:7`, 10 por 15 min) cuenta también las 400; reiniciar el servidor entre tandas.
   - Norma: `buenas-practicas-backend.md` sección 3; `CLAUDE.md` (`async` con `try/catch` y `next(error)`); `seguridad.md` (autenticación).
2. **`errorHandler`: `MulterError` a 400 (decisión 8)**
   - Archivo: `middleware/errorHandler.js` (modificar).
   - Cambio: `const status = err.status || err.statusCode || (err.name === 'MulterError' ? 400 : 500);` y nada más.
   - Comprobación (con token): `POST /upload` con `-F "wrong=@x.xlsx"` → 400 "File upload error: Unexpected field" (antes 500); lo mismo en `POST /upload-image`; un error sin status que no sea `MulterError` sigue dando 500.
   - Norma: `buenas-practicas-backend.md` (manejo de errores); `para-frontend.md` sección 3 (500 a 400, compatible).
3. **`POST /upload`: fichero presente y `.xlsx` (criterios 4-5, decisión 6)**
   - Archivo: `routes/data.js` (modificar; `const path = require('path')` según el estilo del repo).
   - Al inicio del `try`, antes de `convertExcelToJson` (línea 69): sin `req.file` → 400 `'File is required'`; si `path.extname(req.file.originalname).toLowerCase() !== '.xlsx'` o `mimetype` no está en `[XLSX_MIME, 'application/octet-stream', '']` → 400 `'Only .xlsx files are allowed'`. La constante de MIME va local.
   - Comprobación: sin fichero → 400; `x.txt` con MIME xlsx → 400; `x.xlsx;type=text/plain` → 400; `x.xlsx;type=application/octet-stream` pasa la validación; `x.xlsx;type=` (MIME vacío) según el supuesto **(por confirmar)**; un `.xlsx` válido requiere S3 real **(por confirmar si no hay)**.
   - Norma: `buenas-practicas` sección 4 (fila `POST /upload`); `para-frontend.md` sección 3.
4. **`data.js`: `draftKey` y `fileName` cadena (criterio 6, decisión 7)**
   - Archivo: `routes/data.js` (modificar).
   - `/upload/confirm` (línea 111): `!draftKey` pasa a `typeof draftKey !== 'string' || !draftKey`, mismo 400 `'draftKey is required'`. Con un objeto, hoy `.split` revienta en `aws/` (`awsS3connect.js:243` y `:281`) y da 500.
   - `/update-file` y `/delete-file`: tras destructurar y antes de S3, `typeof fileName !== 'string' || !fileName` → 400 `'fileName is required'`.
   - Comprobación: en las tres rutas, `{}`, `{"fileName":123}`, `{"fileName":{}}` (en `confirm`, `draftKey`) → 400; una cadena sigue el camino previo.
   - Norma: `buenas-practicas` sección 4; `seguridad.md` (claves de S3: reduce el riesgo pero no valida contra lista de permitidos, M4, ya fuera de alcance).

## Fase 2 (`content.js`)

5. **Rutas públicas: `/get-image` y `/send-email` (criterios 8-9)**
   - Archivo: `routes/content.js` (modificar).
   - `/get-image`: `const { imageKey } = req.query;` si `typeof imageKey !== 'string' || !imageKey` → 400 `'imageKey is required'` (cubre `?imageKey=a&imageKey=b`, que llega como array); luego `getPresignedUrlFromS3(GALLERY_PATH, imageKey)`. Señalado como M4/M5: la clave sigue construida con texto del cliente.
   - `/send-email`: tras destructurar y antes de `mailOptions`, si alguno de `[username, email, subject, message]` no es `string` o está vacío tras `trim()` → 400 `'username, email, subject and message are required and must be strings'`. No se valida formato de `email`, longitud ni tasa (M3).
   - Comprobación: `GET /get-image` sin parámetro, con `?imageKey=` y con `?imageKey=a&imageKey=b` → 400; con clave real igual que antes (S3). `/send-email` con campo ausente, número o vacío → 400 y no se envía correo; el caso válido envía correo real y queda **(por confirmar)** hasta tener SMTP.
   - Norma: `buenas-practicas` sección 4; `seguridad.md` (correo, claves de S3); `para-frontend.md` (`/get-image` 200 → 400, decisión 4; que el frontend no la llame sin clave, **por confirmar**).
6. **Rutas protegidas: `/upload-term`, `/upload-image`, `/delete-image`, `/delete-term` (criterio 7, decisión 7)**
   - Archivo: `routes/content.js` (modificar).
   - `/upload-term`: `typeof term !== 'string'` → 400 `'Term must be a string'`; después `!term.trim()` → 400 `'Term cannot be empty'` (sin cambios).
   - `/upload-image`: condición pasa a `!file || typeof title !== 'string' || !title`, mismo 400 `'File and title are required'`. Antes un `title` objeto o número reventaba en `title.replace` (línea 90) con 500.
   - `/delete-image`: `typeof imageKey !== 'string' || !imageKey` → 400 `'imageKey is required'` (la comprobación queda antes del `try`, porque no puede lanzar).
   - `/delete-term`: `typeof term !== 'string' || !term` → 400 `'Term is required'`.
   - Comprobación (con token): `/upload-term` con `{}`, `{"term":5}`, `{"term":{}}` → 400 `Term must be a string`; `""` y `"  "` → 400 `Term cannot be empty`. `/upload-image` con `title` ausente o no texto → 400. `/delete-image` con `{}`, `{"imageKey":1}`, `{"imageKey":{}}` → 400. `/delete-term` con `{}`, `{"term":1}`, `{"term":{}}` → 400. Cadena válida: camino previo (S3 real, **por confirmar si no hay**).
   - Norma: `buenas-practicas` sección 4; `CLAUDE.md` (`async` con `try/catch` y `next`).

Criterios transversales (10-12): las 400 nuevas usan `{ success: false, error }` con mensajes fijos sin `err.message` interno; los casos válidos se comparan antes y después (una petición por ruta); `npm run lint` y `npm run quality` pasan sin avisos nuevos (no se toca `--max-warnings` salvo que el número real de avisos baje).

## A cargo del tester-documentador

- Ejecutar la verificación con peticiones reales (`curl` contra `npm start`) y el script del criterio 3; registrar cada criterio 1-12; marcar **(por confirmar)** lo que requiera S3, SMTP o el frontend.
- `docs/07-estado-y-deuda-tecnica.md`:
  - A7 resuelto.
  - A3 resuelto solo para las rutas listadas: `/log`, `/upload`, `/upload/confirm`, `/update-file`, `/delete-file`, `/upload-term`, `/upload-image`, `/delete-image`, `/delete-term`, `/get-image`, `/send-email` y `MulterError`.
  - A3 debe decir qué queda abierto: claves de S3 sin lista de permitidos (M4/M5), formato y límite de `/send-email` (M3), `err.message` en 5xx (M17) y entradas no revisadas por esta spec **(por confirmar)**.
  - D3 con la parte de backend resuelta y pendiente el `accept` de `FileUpload` en el frontend.
  - Fecha "actualizado" y métricas al día.
- `docs/04-api.md`: respuestas 400 nuevas de cada ruta afectada y la entrada que las provoca; `MulterError` a 400 en `/upload` y `/upload-image`.
- `docs/guias/buenas-practicas-backend.md`: tabla de la sección 4, fila de la sección 3 que dice "No cumple" para `POST /upload`, y fila de anti-patrones de la sección 15 (A3).
- `docs/05-modulos.md`: `userAuth` recibe `next` y devuelve 400; `errorHandler` trata `MulterError` como 400; manejadores con validación.
- `docs/integracion/para-frontend.md`: "Códigos usados hoy" deja de decir "parcial / A3"; fila de tipo de fichero en `/upload` con `.xlsx` y MIME tolerante; avisos de `/get-image` 200 → 400 y de `/log` sin contraseña de colgado a 400.
- `npm run docs:check` y `npm run docs:gate` antes del commit; preparar el aviso para la PR (`docs/specs/*-aviso-pr.md`, contrato con el frontend); proponer el mensaje de commit.

## Pruebas

Sin base de tests (M11): `curl` contra `npm start`, como indica cada paso. Comandos: `npm run lint`, `npm run quality`, `npm run docs:check`, `npm run docs:gate`. `agentes:test` no aplica (no se toca `plugins/`).

## Cierre

- Documentos de `integracion` afectados: `para-frontend.md` (cambio compatible según su sección 3, a avisar en la PR). `para-infra.md` no se ve afectado.
- Campos opcionales de `flujo.json`: ninguno faltaba. `consultor` es "ninguno".
