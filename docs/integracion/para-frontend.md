# Integración con el frontend: lo que ofrece y necesita el backend

Documento para quien mantiene `sigmetum-frontend`. Sigue la convención de [../guias/mantenimiento.md](../guias/mantenimiento.md#6-avisar-al-frontend-y-a-la-infraestructura): dice qué garantiza este backend, qué espera del frontend, el estado de las discrepancias y qué avisar si algo cambia.

- Lo verificado contra el código está marcado **(verificado)**; lo deducido pero no probado, **(por confirmar)**.
- Fecha de la verificación: 30/09/2026. Backend: rama `feature/sigmetum_v2`, commit `ace5367`. Frontend: rama `feature/sigmetum_front_v2`, commit `f805222`.
- La referencia completa de la API es [../04-api.md](../04-api.md); aquí no se repite.
- Los ids de este documento llevan el prefijo **F**. Al citarlos desde otro repositorio: `backend:F1`. Los que cita este documento del frontend llevan su prefijo: `frontend:D2`.

## 1. Resumen

| Id | Qué pasa | Efecto |
|---|---|---|
| **F1** | `GET /get-data/:path(*)` es público y lee cualquier clave del bucket, pero es el único endpoint que puede abrir una versión histórica | El frontend lo usa para abrir un Excel de versión, que hoy da error (`frontend:D1`). No se puede cerrar sin dar antes un sustituto |
| **F2** | `POST /upload` responde el `processedData` completo en el 400 de fila vacía | Con un Excel grande, la respuesta pesa más de lo necesario; el frontend no lo usa (`frontend:D8`) |
| **F3** | ~~`GET /list-images` responde 500 si la galería está vacía, en vez de `[]`~~ **Resuelto en el backend el 29/10/2026 (A5/D5)**: con la galería vacía o con solo el marcador `gallery/` responde `200` `data: []`; el marcador ya no sale como imagen de `fileName` vacío | Cambio compatible. Que el frontend no dependa del elemento de clave vacía del marcador está **(por confirmar)** (`frontend:D5`) |
| **F4** | ~~El login (`POST /log`) puede quedarse sin responder si falta `password`~~ **Resuelto el 28/10/2026**: ahora responde `400` si `username` o `password` no son cadenas | El frontend puede no distinguir un `400` de un `401` en el login **(por confirmar)**; antes la petición no recibía respuesta (hallazgo interno A7) |
| **F5** | `GET /get-image` sin `imageKey` pasa de `200` (URL a `gallery/undefined`) a `400` `imageKey is required` (28/10/2026) | Que el frontend no la llame sin clave está **(por confirmar)** |
| **F6** | ~~`tokenAuth` se ejecutaba también para `POST /send-email`, `GET /get-image`, `GET /list-images` y `GET /list-terms` (sin token, `401 No token provided`)~~ **Resuelto en el código el 28/10/2026 (entrega 2 de M21)**: `tokenAuth` solo va en las nueve rutas 🔒 y esas cuatro rutas responden sin token con `200`, `400`, `429` o `500` | Es el cambio de contrato de F7 (compatible condicionada). Hallazgo interno M21; en producción no se ha verificado lo que respondía **(por confirmar)** |
| **F7** | **Entrega 1 de M21 (28/10/2026)**: `POST /send-email` puede responder `400` por formato y longitud (nombre ≤ 100, asunto ≤ 150, mensaje ≤ 2000, correo ≤ 254 y con la forma básica `algo@dominio.tld`, sin caracteres de control en nombre, correo ni asunto y sin controles, salvo salto de línea y tabulador, en el mensaje; un correo con apóstrofo como `o'brien@example.com` se rechaza, **(por confirmar)** si preocupa) y `429` por superar 5 peticiones cada 15 minutos por IP; `GET /get-image` y `DELETE /delete-image` responden `400` `imageKey is not valid` para una clave que no cumple la [regla de `imageKey`](../06-almacenamiento-s3.md#regla-de-imagekey). **Desde la entrega 2 de M21 (28/10/2026) también son alcanzables sin token** (las cuatro rutas de F6 dejan de dar `401`): el formulario de contacto y la galería públicos pasan a llegar al manejador | Clasificación (entregas 1 y 2): **compatible, condicionada** a (a) que las entradas reales (campos de `ContactForm`, claves de `list-images`) cumplan las reglas, (b) que el frontend muestre un error sin romperse ante `429`/`400` de `/send-email` y (c) que el panel no envíe a `DELETE /delete-image` claves que la regla rechace, y, por la entrega 2, (d) que el frontend llame de verdad sin token a `POST /send-email`, `GET /list-images`, `GET /get-image` y `GET /list-terms` y no use su `401` como señal (por ejemplo, redirigir al login), y (e) que no consuma como contrato el `404` de las rutas inexistentes (ver más abajo). Todas **(por confirmar)** contra el código del frontend. Si alguna no se confirma, es incompatible. **Entrega 3 (28/10/2026), clasificación compatible:** una ruta inexistente o un método no definido pasa del `404` HTML de Express a un `404` JSON `{ success: false, error: "Not found" }` (mismo estado, texto fijo, también fuera del prefijo, sin `405` ni `Allow`), con o sin token; no renombra ni quita campos ni exige `/api/v2`. Despliégala seguida de la entrega 2 (entre ambas, esas rutas daban un `404` HTML). Condición (e): que ningún flujo del frontend (incluido `FileUpload.js`, que usa `fetch` propio) dependa del cuerpo HTML del `404` sigue **(por confirmar)**; `src/services/api.js` hace `await response.json()`, así que el `404` HTML lanzaba un error de parseo y el JSON cae en `!json.success`. Backend primero es seguro: un frontend que ya llama sin token empieza a funcionar. Hallazgos: el selector del panel acepta `gif` (se incluye en la regla); `ContactForm` no pone `maxLength`, así que un texto largo (> 2000 en el mensaje) recibirá `400`; su documentación dice que muestra un diálogo de éxito o de error, pero su manejo real del `400`/`429` está **(por confirmar)** en el código. El resultado de contrastar la regla con el listado real de la galería está **(por confirmar)** (ver M21 en [07](../07-estado-y-deuda-tecnica.md)) |
| **F8** | **A1/A4 (28/10/2026)**: (1) el día del nombre `AAAA-MM-DD_vN.xlsx` pasa a ser el día **UTC** (formato intacto; entre las 00:00 UTC y las 01:00-02:00 de España el nombre lleva el día anterior al local); (2) `POST /upload` responde `400` en casos antes aceptados: `Province is required`, `Province is not valid`, `Province is reserved`, `Excel contains more than one province` (ya no existe la carpeta `Desconocido`); (3) `POST /upload/confirm`, `POST /update-file` y `POST /delete-file` responden `400` `Invalid draftKey` / `Invalid fileName` con claves mal formadas o con la provincia no NFC (antes llegaban a S3); (4) los listados por prefijo llevan barra final (sin cambio visible en `GET /list-files`) | Clasificación: **compatible, condicionada** a que (a) el frontend mande siempre claves salidas de `GET /list-files` o de `draftKey`, y (b) las carpetas reales del bucket estén en NFC y cumplan la [regla de provincia](../06-almacenamiento-s3.md#regla-de-provincia). Si existe una carpeta en NFD o con un nombre que la regla rechace, esa versión no se podría activar ni borrar desde el panel: es incompatible para ese caso. Que `FileDropdown` y `FileUpload` solo envíen esas claves y muestren bien un `400` está **(por confirmar)** contra el código del frontend, y las carpetas reales del bucket (dev y prod) también. D2 sin cambios de formato |
| **F9** | **A5, A6, A8, M7 y M10 (29/10/2026)**: (1) `GET /list-images` con la galería vacía pasa de `500` a `200` `[]` (F3); (2) **A6, único cambio observable con aviso en la PR**: un fallo de S3 distinto de `NoSuchKey` (permisos, red, 5xx), o un glosario de 0 bytes, corrupto o no-array, pasa en `GET /list-terms` de `200` `[]` a `500` genérico, y `POST /upload-term` y `DELETE /delete-term` responden `500` sin sobrescribir el glosario (con `AccessDenied`, las dos primeras dan `Access denied to storage` y `delete-term` daba `Internal server error`, corregido después por B5, F10); `NoSuchKey` sigue dando `200` `[]`; (3) `GET /list-files` y `GET /get-merged-data` dejan de truncarse con más de 1000 objetos y `/get-merged-data` lee en paralelo (mismo contenido y orden); (4) el activo se regenera desde la versión correcta (`_v10` frente a `_v9`) y, si solo quedan `.xlsx` no estándar, no se toca | Clasificación: **compatible**, sin `/api/v2`: no cambia el envoltorio ni los campos; A6 se avisa en la PR (decisión del usuario). Que el frontend muestre bien un `500` en la carga del glosario y no dependa del marcador de la galería está **(por confirmar)** |
| **F10** | **B9 y B5 (29/10/2026)**: (1) **B9, único cambio que añade un estado nuevo**: un `NoSuchKey` de S3 que llega a `errorHandler` pasa de `500` a `404` `{ success: false, error: "The requested file does not exist in storage" }` (texto distinto de `Not found`, el de ruta inexistente). Caso normal: `GET /get-data/:path`, `POST /update-file` y `POST /upload/confirm` al confirmar. Solo en carrera (el objeto desaparece entre el listado y la lectura): `GET /get-merged-data`, `POST /delete-file` y `POST /upload/confirm` al cancelar. Sin cambio: `DELETE /delete-image` y `POST /delete-file` ante clave inexistente (`200`), `GET /get-image` (`200`), glosario (`200`), `NoSuchBucket`, `AccessDenied` y red (`500`); (2) **B5**: los `500` de `DELETE /delete-image` y `DELETE /delete-term` llevan ahora el texto mapeado (`Access denied to storage`, `Storage bucket is not configured correctly`, `Storage connection error`) en vez de `Internal server error` | Clasificación: **compatible, condicionada**, sin `/api/v2`: no cambia el envoltorio ni los campos, y `services/api.js` guarda `error.status` y `error.serverMessage` pero según el documento ningún componente los usa (28/10/2026). **(Por confirmar)** contra el código del frontend (`FileUpload.js`, que usa `fetch` propio, y `FileDropdown`) que ninguno interpreta el `404` como «no existe»; si lo hace, el cambio es incompatible. Riesgo: un fallo de datos a mitad de una operación se lee como «no existe» (en `POST /delete-file`, un `404` tras un borrado que sí ocurrió). Sin cambios de código en el frontend (sección 5) |

## 2. Qué garantiza el backend

### Envoltorio y códigos de estado

| Garantía | Detalle |
|---|---|
| Envoltorio único | Toda respuesta es `{ success: true, data }` o `{ success: false, error }` **(verificado)** (también el `404` de rutas inexistentes y métodos no definidos, desde la entrega 3 de M21: `{ success: false, error: "Not found" }`) |
| Éxito | `response.ok` (2xx) y `success: true` van siempre juntos |
| Códigos usados hoy | `200` éxito, `404` recurso ausente en S3 (desde el 29/10/2026, B9, F10) y ruta inexistente, `400` entrada inválida (desde el 28/10/2026 también `POST /log` sin `username` o `password` de tipo cadena, `/upload`, `/upload/confirm`, `/update-file`, `/delete-file`, `/upload-term`, `/upload-image`, `/delete-image`, `/delete-term`, `GET /get-image` sin `imageKey`, `POST /send-email` con campos ausentes y errores de multipart; hallazgo A3; desde la entrega 1 de M21 también `POST /send-email` por formato o longitud y `imageKey is not valid` en `GET /get-image` y `DELETE /delete-image`, ver F7), `401` sin token o inválido (solo en las rutas 🔒), `429` límite de intentos del login y el de `POST /send-email` (también sin token), `403` origen no permitido por CORS (desde el 28/10/2026, M22), `500` fallo interno o de S3 (con el texto fijo `Internal server error` o un mapeado de almacenamiento, ver abajo); el `400` de `/send-email`, `GET /get-image` y el resto de F7 se alcanza sin token en las rutas 🔓 |
| No usados hoy, pero reservados por la garantía de versionado | `403` para otros casos distintos de CORS (el `403` ya se usa para el origen no permitido, ver arriba; el resto de casos siguen devolviendo 500). El `404` se emite para rutas inexistentes y métodos no definidos (`Not found`) y, desde el 29/10/2026 (B9, F10), para un recurso ausente en S3 (`The requested file does not exist in storage`) |
| Subidas grandes (M6, 28/10/2026) | `POST /upload` por encima de 10 MB y `POST /upload-image` por encima de 5 MB dan `400` `{ success: false, error: "File exceeds the maximum allowed size" }` (máximo aceptado exacto). **Cambio compatible** (validación de entrada más estricta, mismo envoltorio). Que el frontend no suba hoy ficheros por encima de esos límites y muestre el mensaje del 400 está **(por confirmar)**. B8: el JWT no cambia de campos ni de caducidad (HS256 fijado; los tokens vigentes siguen valiendo, por confirmar): sin impacto |
| Mensaje de error | `error` es un texto en inglés, pensado para depurar, no para mostrar tal cual al usuario (coincide con lo que ya hace `services/api.js`). **Desde el 28/10/2026 (M17 y M22)** los `500` llevan el texto fijo `Internal server error` o un mapeado de almacenamiento (`The requested file does not exist in storage`, `Storage bucket is not configured correctly`, `Access denied to storage`, `Storage connection error`); un JSON mal formado da `400` `Invalid JSON`, un cuerpo de más de 100 KB `413` `Payload too large`, otro 4xx de librería `Bad request`, y un origen CORS no permitido `403` `Origin not allowed` (antes `500` con el origen reflejado). El mensaje real solo va a la consola del backend. Los textos de validación `400` de las rutas no cambian. **Clasificación: compatible**, sin `/api/v2`: `services/api.js` guarda `json.error` en `error.serverMessage` y el estado en `error.status`, pero ningún componente los usa ni compara texto ni estado (comprobado el 28/10/2026); el navegador, además, no deja a la página ver la respuesta CORS rechazada. Efectos conocidos: `GET /list-images` con la galería vacía daba `500` (F3; desde el 29/10/2026 responde `200` `[]`); `DELETE /delete-image` y `DELETE /delete-term` fallidos devolvían siempre `Internal server error` (B5); desde el 29/10/2026 llevan el texto mapeado (F10). Si el frontend empezara a comparar estos textos o estados, habría que revisarlo |

### Estabilidad de `/api/v1`

- El prefijo `API_PREFIX` (`/api/v1` por defecto) es estable: no cambia sin subir a un prefijo nuevo.
- **Cambio compatible** (no rompe `/api/v1`): un campo nuevo en una respuesta, un endpoint nuevo, una validación de entrada más estricta que antes daba 500 y ahora da 400.
- **Cambio incompatible** (exige `/api/v2`): renombrar o quitar un campo que el frontend lee, cambiar el envoltorio `{ success, data | error }`, cambiar `fixedColumnOrder` (las 11 columnas del Excel, por nombre u orden), cambiar el formato de nombre de versión (`AAAA-MM-DD_vN.xlsx`), cambiar qué campos lleva el JWT o cómo caduca.
- **Procedimiento para un cambio incompatible:** se sirve en un prefijo nuevo (`/api/v2`) mientras `/api/v1` sigue funcionando. Plazo de retirada propuesto: **al menos una versión de despliegue de ambos repositorios** después de que el frontend confirme la migración, nunca una fecha fija por calendario. Se avisa en la PR que introduce el cambio y se anota aquí, en la sección 5.
- Hoy no hay ningún cambio incompatible planeado.

### Campos que lee el frontend, contrastados

Contra la sección 2 de `../sigmetum-frontend/docs/integracion/para-backend.md` (30/09/2026). El backend no cambia la forma de estos campos sin pasar por la política de arriba:

| Endpoint | Campos que lee el frontend | Backend los garantiza |
|---|---|---|
| `POST /log` | `data.token` | Sí |
| `GET /auth` | Solo el código de estado | Sí |
| `GET /get-merged-data` | `data`: array de registros con las 11 columnas | Sí |
| `GET /list-files` | `data`: `{ [provincia]: [{ key, name }] }` | Sí |
| `GET /get-data/<key>` | `data`: array de registros | **No, si `<key>` es un `.xlsx`** (ver F1) |
| `POST /upload` | Con `400`: `data.emptyFields[].rowIndex`, `data.draftKey`. Con `200`: solo el estado | Sí, aunque el `400` incluye más de lo que se necesita (F2) |
| `POST /upload/confirm`, `POST /update-file`, `POST /delete-file` | Solo el estado | Sí (con claves válidas; las mal formadas dan 400, F8) |
| `GET /list-terms` | `data`: `[{ term }]` | Sí |
| `GET /list-images` | `data`: `[{ fileName, url }]` | Sí (con la galería vacía, `[]`; F3 resuelto el 29/10/2026) |
| `POST /upload-image`, `DELETE /delete-image`, `POST /upload-term`, `DELETE /delete-term`, `POST /send-email` | Solo el estado | Sí |
| `GET /get-image?imageKey=` | `data.imageUrl` | Sí (sin pantalla que lo use hoy, según el frontend) |

## 3. Qué espera el backend del frontend

| Requisito | Detalle |
|---|---|
| Autenticación | Cabecera `Authorization: Bearer <token>` en toda ruta protegida (🔒 en [../04-api.md](../04-api.md)). Las rutas 🔓 ignoran la cabecera: con un token inválido o caducado responden como sin token |
| Cuerpo de las peticiones | JSON con `Content-Type: application/json`, salvo `POST /upload`, `POST /upload/confirm` (multipart) y `POST /upload-image` (multipart) |
| Campos multipart | `POST /upload`: campo `file`. `POST /upload-image`: campos `file` y `title` |
| Tipo de fichero en `/upload` | Solo `.xlsx`. Desde el 28/10/2026 el backend responde `400` `File is required` sin fichero y `400` `Only .xlsx files are allowed` si la extensión no es `.xlsx` (sin distinguir mayúsculas). El MIME no se comprueba: un `.xlsx` llega aunque el navegador lo etiquete como `application/vnd.ms-excel`, `application/x-zip-compressed`, `text/plain` o sin tipo (compatible, se acepta más). **Cambio visible**: `.xls` y `.xlsm` (y `.csv`, `.txt`) dan `400` por extensión desde el 28/10/2026, con cualquier MIME. El frontend debería restringir el selector (`accept` de `FileUpload`) a `.xlsx` (D3) |
| Tipo de fichero en `/upload-image` (M5, 29/10/2026) | **Cambio compatible condicionado** (mismo envoltorio; hay `400` donde antes había `200`). Solo se aceptan `.jpg`, `.jpeg`, `.png`, `.gif` y `.webp` con su MIME exacto (`image/jpeg`, `image/png`, `image/gif`, `image/webp`) y con la firma real del contenido. Tres `400` de texto fijo: `Image type not allowed`, `Image title is not valid` y `File content does not match the image type` (más el ya existente `File and title are required`). El `accept` actual del frontend es `image/jpeg, image/png, image/gif, image/webp`. La extensión de la clave pasa a minúsculas (`foto.JPG` y `foto.jpg` son la misma clave). El título se sanea y da `400` si lleva `/`, `\`, `..`, un carácter de control o cualquiera de `, ' : & # ? %` (por ejemplo `Encinar, vista 1` o `Bosque d'Or`), porque la regla de lectura de `imageKey` no los admite. `.jfif`, `.jpe` y `.pjpeg`, que el `accept` deja elegir, ya no se suben. Un navegador o sistema sin registro de tipo para `.webp` manda MIME vacío y recibiría `400`. **(Por confirmar)**: que el frontend no sube HEIC ni SVG (el selector permite "Todos los archivos"), ni títulos con esos signos, ni depende de mayúsculas en la extensión; el MIME en mayúsculas con un cliente real. Si alguno resultara cierto, se revisa como incompatible (`/api/v2`) |
| `GET /get-data` | **No usarlo para abrir un Excel de versión** (F1): hoy intenta `JSON.parse` de un binario. Úsese solo para leer un JSON ya existente bajo `data/active/` |
| Límite de peticiones | `POST /log` corta a 10 intentos cada 15 minutos por IP y responde `429` con `{ success: false, error }`. El frontend debería distinguir ese código del resto (`frontend:D7`). `POST /send-email` corta a 5 peticiones cada 15 minutos por IP y responde `429` con el mismo envoltorio (`Too many messages. Please try again in 15 minutes.`); el contador está en memoria (se reinicia al desplegar) y los usuarios tras un mismo NAT comparten el cupo. Desde la entrega 2 de M21 el cupo lo consume también el tráfico sin token, y cuentan los `400`; depende de `trust proxy 1` **(por confirmar con infra)** (F7) |
| CORS | El origen debe coincidir **exactamente** con `ALLOWED_ORIGIN` del entorno; sin barra final. Un origen distinto recibe `403` `Origin not allowed` (el navegador lo bloquea por CORS y no muestra la respuesta) |

## 4. Discrepancias vigentes

Clasificación de `D1` a `D9` de `../sigmetum-frontend/docs/integracion/para-backend.md` (30/09/2026), más lo que solo ve este lado. El detalle completo, con archivo y línea, está en ese documento y en [../07-estado-y-deuda-tecnica.md](../07-estado-y-deuda-tecnica.md).

| Id | Responsable de actuar | Acción pendiente en el backend |
|---|---|---|
| `frontend:D1` (F1) | Backend y frontend | Crear un endpoint que convierta un Excel de versión en registros (`convertExcelToJson`), limitado a claves `data/{provincia}/AAAA-MM-DD_vN.xlsx`. No cerrar `GET /get-data` hasta entonces |
| `frontend:D2` | Solo frontend | Ninguna; el formato `AAAA-MM-DD_vN.xlsx` no cambia sin aviso (el día del nombre es UTC desde el 28/10/2026, F8) |
| `frontend:D3` | Frontend y backend | Parte de backend resuelta el 28/10/2026 (`req.file` y solo extensión `.xlsx` en `POST /upload`, 400; `.xls` y `.xlsm` se rechazan por extensión). Pendiente solo el `accept` de `FileUpload` en el frontend |
| `frontend:D4` | Solo frontend | Ninguna |
| `frontend:D5` (F3) | Backend (hecho el 29/10/2026) | Resuelto: `[]` con la galería vacía o con solo el marcador (F3, F9) |
| `frontend:D6` | Solo frontend | Ninguna |
| `frontend:D7` | Frontend (y ver M12 de este repo) | El límite de 10 intentos solo es fiable si `trust proxy` está bien configurado detrás del ALB; sin eso, el 429 puede dispararse para todos los clientes a la vez |
| `frontend:D8` (F2) | Backend | Omitir o limitar `processedData` en el 400 de `POST /upload` |
| `frontend:D9` | Ninguno (informativa) | — |

## 5. Si cambias algo en el backend

| Si cambias... | El frontend debe actualizar... |
|---|---|
| El prefijo de la API | `VITE_API_PREFIX` (Amplify, ver `../sigmetum-infra`) |
| Una ruta, su método o si es pública o protegida | `src/services/api.js` y el componente que la llama |
| El envoltorio `{ success, data \| error }` | `src/services/api.js` (un único sitio) |
| `fixedColumnOrder` (nombre, orden o número de columnas) | Traducciones (`attributes.*`), `DialogSpecies.js`, `Filter`/`Explore` |
| El formato de nombres de versión (o la zona horaria de su fecha) | `utilities/FormatFileName.js`, `FileDropdown` |
| La forma de `emptyFields` o `draftKey` en el 400 de `/upload` | `components/FileUpload.js` |
| Los campos de `/list-files` | `components/FileDropdown.js` |
| Las claves del JWT o cómo caduca | `components/ProtectedRoute.js` |
| `ALLOWED_ORIGIN` de un entorno | Nada en el código; confirmar que coincide con el dominio real del frontend de ese entorno (`../sigmetum-infra`) |
| Se crea el endpoint de F1 | `FileDropdown.handleVersionSelect` |
| Se cierra o restringe `GET /get-data` | Solo después de resolver F1 |
| Límites de tamaño o tipo en `/upload` o `/upload-image` | `accept` y mensajes de los formularios |
| El texto o el estado de los errores de `errorHandler` (M17, M22) | `src/services/api.js` (`error.serverMessage`, `error.status`); hoy ningún componente los usa (28/10/2026) |

**Orden de despliegue:** un cambio incompatible se despliega primero en el backend bajo el prefijo nuevo, manteniendo el anterior activo, y solo después se actualiza el frontend para consumirlo. Un cambio compatible no exige orden especial.

## 6. Cómo mantener este documento

- Se actualiza en el mismo commit que cambia cualquiera de los archivos de la sección 5, siguiendo [../guias/mantenimiento.md](../guias/mantenimiento.md).
- Las discrepancias resueltas se verifican contra el código del frontend, se pasan a una línea del historial de [../07-estado-y-deuda-tecnica.md](../07-estado-y-deuda-tecnica.md) y se quitan de la tabla de la sección 4.
- Si el frontend actualiza su `para-backend.md` con una discrepancia nueva, se revisa aquí y se clasifica.
