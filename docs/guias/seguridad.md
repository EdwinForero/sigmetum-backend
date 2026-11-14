# Seguridad de la API

Normas para no introducir vulnerabilidades en este repositorio, con el estado real de cada una. Cada regla dice **por qué**, **cómo se comprueba** y **cómo está hoy**.

- Complementa a [buenas-practicas-backend.md](buenas-practicas-backend.md). El procedimiento de revisión paso a paso está en la skill `security-pre-merge` ([plugins/README.md](../../plugins/README.md)); las normas y su motivo, aquí.
- Lo que depende de la infraestructura está en `sigmetum-infra`; lo que depende del frontend, en `../sigmetum-frontend/docs/integracion/para-backend.md`.
- Los hallazgos con id (A, M, B, D, I) están en [07](../07-estado-y-deuda-tecnica.md). Esta guía **no los repite**: los referencia y los convierte en reglas.
- Si un cambio contradice una regla de esta guía, **avisa y pregunta** antes de hacerlo.
- Marcas de certeza: **(verificado)** lo comprobado contra el código, ejecutándolo o en `sigmetum-infra`; **(por confirmar)** lo deducido.

## 1. Qué hay que proteger

| Activo | Riesgo principal |
|---|---|
| **Sesión del administrador** (token de acceso de Cognito, verificado con las claves públicas del pool) | Que se acepte un token falso, de otro emisor o de otro tipo; que cualquier usuario del pool administre (C16); que el JWKS caído deje la API sin servicio |
| **Datos de investigación** (públicos, pero su integridad importa) | Que una carga incorrecta o maliciosa los corrompa o los borre |
| **El bucket de S3** | Leer o escribir fuera de lo previsto mediante claves que construye el cliente |
| **La cuenta de Gmail** del formulario de contacto (`EMAIL`, `EMAIL_PASSWORD`) | Que se use para enviar correo no deseado |
| **Credenciales de AWS** | Que se filtren (en el repositorio o en los logs). En producción son el rol IAM de la instancia |
| **Disponibilidad** (una t3.nano detrás de un ALB) | Que una petición costosa o colgada deje la API sin servicio |

Toda la seguridad real está aquí: el frontend solo evita errores y no facilita ataques.

## 2. Reglas

### S1. Ningún secreto en el repositorio ni en los logs

- **Por qué:** quien lea el código o los logs podría actuar como administrador o usar el bucket.
- **Cómo:** `npm run quality` busca claves de AWS, claves privadas, tokens de GitHub, tokens `Bearer` y JWT literales y hashes bcrypt literales en código, `.env.example`, documentación y `.claude/`; exige que los secretos de `.env.example` estén **vacíos**; comprueba que ningún `.env` está versionado y que `package-lock.json` lo está; y prohíbe escribir `req.body`, cabeceras, tokens, contraseñas o `process.env` en un `console.*`.
- **Estado:** cumple **(verificado)**. `.env*` está en `.gitignore`.

### S2. Autenticación

| Regla | Por qué | Se comprueba | Estado |
|---|---|---|---|
| El backend **solo verifica tokens de acceso de Cognito** con `aws-jwt-verify` (sin login propio, sin secretos de firma, sin contraseñas): `iss` del pool configurado, `token_use` `access`, `exp` numérico finito y vigente, y firma RS256 con el JWKS del pool | El backend no emite ni firma nada: no hay `JWT_SECRET` que filtrar ni contraseña que adivinar. Cada token falso, de otro pool o de otro tipo da 401 | Tests (`tests/cognito-verificador.test.js`) | Cumple desde el 09/11/2026 (reemplaza a HS256, `JWT_SECRET` y el login con bcrypt) |
| El algoritmo es **RS256 fijo** y nunca sale del cabecero del token (B8) | Evita la confusión de algoritmo (HS256 con la clave pública como secreto) y `alg: none` | Tests (`tests/jwt-algoritmo.test.js`, `tests/cognito-verificador.test.js`) | Cumple desde el 09/11/2026: HS256, HS512, HS256 con la clave pública como secreto y `none` dan 401 `Invalid token` |
| `COGNITO_USER_POOL_ID` es obligatoria en todo entorno y se valida (forma `<región>_<id>`, región igual a `AWS_REGION`, con la regla de la propia librería) | Un pool mal escrito haría que cada petición diera un 401 silencioso | `validateEnv` y `tests/validate-env.test.js` | Cumple (M15): falla cerrado también en `local` y `test`; el mensaje nombra variable y regla, nunca el valor |
| El emisor se acepta en los dos formatos que emite Cognito para el **mismo pool** (`cognito-idp` e `issuer-cognito-idp`) | Es el comportamiento de la librería (misma clave y mismo pool); se documenta en vez de ocultarlo | Test de caracterización | Aceptado; otra región u otro pool dan 401 |
| El JWKS **no se pide en cada petición**: caché y penalización de recargas | Un `kid` desconocido o un JWKS caído no puede provocar una petición de red por petición entrante | `tests/cognito-jwks.test.js` (cuenta peticiones con un JWKS simulado) | Cumple con límites: la librería penaliza por URI (espera de 10 s, no por `kid`) y solo cuando el JWKS carga y el `kid` no está; un fetcher propio envuelve al de la librería y registra los fallos de red en la misma penalización. Consecuencia: un `kid` falso provoca hasta 10 s de `503` a los `kid` **nuevos** (los cacheados no se ven afectados; el frontend debe reintentar). `JwksValidationError` (JWKS cargado pero inválido) no penaliza. Node 22 **(por confirmar)**: solo se probó con Node 24.16 |
| Los errores no filtran nada: `401` `No token provided` / `Invalid token` / `Token expired`, `503` `Authentication service unavailable` (texto fijo); `req.user` solo con `sub`, `client_id` y `username` | Ni el mensaje de la librería, ni el token, ni `scope` ni grupos llegan al cliente o a `req.user`; el log de un 503 lleva solo el nombre de la clase del error | Tests | Cumple |
| Los tokens **caducan** (acceso 60 minutos, refresco 8 horas: los fija Cognito, no el backend) y el backend **no revoca** | Un token robado deja de servir al caducar; el backend no tiene logout ni lista de revocación | `exp` vigente exigido | Cumple; la revocación anticipada queda fuera de alcance |
| Los limitadores tienen **`trust proxy`** bien configurado | Detrás del ALB, sin `trust proxy`, todos los clientes comparten una IP y el mismo contador | `app.js`, `config/trustProxy.js` | El login ya no existe; el único limitador es el de `/send-email` (5 por 15 minutos por IP). `trust proxy` es configurable con `TRUST_PROXY_HOPS` (M12, 30/10/2026; 1 si no se define), pero el valor correcto depende de la cadena real de proxies, que infra debe medir y fijar **(por confirmar con infra)**: mayor que el real deja esquivar el límite con `X-Forwarded-For`, menor hace que todos compartan el cupo. Los limitadores usan `limit` (B6 resuelto el 28/10/2026) |
| Las dependencias de autenticación están al día | Una librería de verificación desactualizada puede aceptar tokens falsos | `npm run quality` | `aws-jwt-verify` 5.2.1 (versión exacta; mantenida por AWS, Apache-2.0, sin dependencias). `jsonwebtoken` y `bcrypt` se retiraron, y con ellas sus avisos (M16); el `npm audit` de producción queda como estaba (M20, sin tapar) |

Sin objeto desde el 09/11/2026: el manejador de login sin `try/catch` (A7), el mensaje único para usuario y contraseña incorrectos, la rotación de `JWT_SECRET` y el hash bcrypt de `ADMIN_PASSWORD`; las cuatro variables ya no existen. Si `prod` aún las conserva hasta `S18-prod`, el backend no las lee.

### C16. Cualquier usuario del pool es administrador

- **Riesgo aceptado.** El backend no valida `client_id` ni grupos: **cualquier usuario autenticado del pool es administrador**. Es aceptable solo con registro cerrado (`allow_admin_create_user_only = true`) y un pool que contenga solo administradores. Si entra un usuario que no deba administrar (otro cliente de aplicación en el mismo pool, un grupo no administrador), este diseño lo autoriza igualmente.
- **Vía de salida (fuera de alcance, spec nueva):** validar el `client_id` esperado (exige `COGNITO_CLIENT_ID` en el backend y, en `dev`, separar el cliente en otro `apply` de infra) y/o exigir un grupo `admin`. `req.user` conserva `client_id` desde el principio; los grupos no se exponen.
- **Ampliado el 12/11/2026 (destinatarios del formulario de contacto):** cualquier usuario del pool puede **cambiar a quién llegan los mensajes de contacto** (nombre, correo y texto de quien escribe, datos personales) con `POST /add-recipient` y `DELETE /delete-recipient`, por ejemplo añadiendo una dirección propia. **Mitigación parcial, no cierre**: un limitador de 10 cambios cada 15 minutos por IP (`recipientsLimiter`) y un aviso por correo a los destinatarios de la lista anterior con la dirección enmascarada; **el aviso lo detecta, no lo impide**. El modelo de autorización no cambia (sigue sin comprobar grupos ni `client_id`). Además, la carrera M1 puede dejar una baja sin aplicar mientras el aviso dice que se quitó (una dirección maliciosa sin aviso; mitigación futura `If-Match`).

### S3. Autorización

- **Por qué:** `tokenAuth` es la única barrera. Hay un solo rol: cualquier token válido de Cognito es el administrador (C16, en S2).
- **Reglas:** toda ruta `POST`, `PUT`, `PATCH` o `DELETE` lleva `tokenAuth` como **primer manejador de la propia ruta** (`router.post('/x', tokenAuth, ...)`, y antes de `multer` en las subidas). No se usa `router.use(tokenAuth)` sin ruta: intercepta peticiones de otras rutas (M21). Una ruta pública que modifica estado es una **excepción registrada y justificada**.
- **Cómo:** `npm run quality` falla con una ruta mutante cuyo `tokenAuth` no sea el primer manejador y que no esté en `PUBLIC_MUTATING_ROUTES` (y con una excepción que ya no exista). Además ejecuta la suite de `tests/` (`--test-reporter=tap`), que recorre la pila real de `app.js`: `tests/estructura-rutas.test.js` falla con una ruta sin clasificar, una protegida sin `tokenAuth` como primer manejador, una pública con `tokenAuth` o un `use(tokenAuth)` a nivel de router, y `tests/rutas-protegidas.test.js` comprueba el `401` de las protegidas, incluido `GET /auth`, y de toda ruta mutante de la pila. La detección estática no ve `router.route()`, `router.all`, `router.use` ni rutas en variables: solo la pila real las cubre. Tampoco ve una declaración partida en varias líneas (limitación en el lado inseguro: una mutante así no se marcaría como sin proteger); por eso `quality` suma como problema, con `unparsedRouteLines()` de `scripts/lib/repo.mjs`, toda línea de `routes/` que empieza por `router.`, `protectedRouter.` o `app.` seguido de `get|post|put|patch|delete|all|use|route(` y no casa con el patrón completo, y esa ruta hay que escribirla en una sola línea. La suite carga la `app.js` real (incluidos `cors`, `compression` y `morgan`, este último silenciado en los tests) con S3 y nodemailer simulados; el 403 de CORS se comprueba por comportamiento (sin reflejar el origen, `publicMessage` en el cuerpo y `warn` truncado). Un arranque real con entorno ficticio sigue siendo la prueba del despliegue.
- **Estado:** cumple **(verificado)**. Excepciones vigentes:

| Ruta | Por qué es pública | Condición para mantenerla |
|---|---|---|
| `POST /send-email` | Formulario de contacto: no exige token (ni lo ejecuta, desde la entrega 2 de M21) | Límite de peticiones y validación (M3). Los tiene desde el 28/10/2026: 5 por 15 minutos por IP (almacén en memoria; cuenta también el tráfico anónimo y los 400) y validación de los cuatro campos. El límite depende de que `TRUST_PROXY_HOPS` (1 por defecto) cuente bien los saltos delante de Express **(por confirmar con infra)** |

La lectura autenticada de una versión `.xlsx` (`GET /get-data/:path`) responde con `Cache-Control: no-store` (12/11/2026): lo que va tras token no se deja en cachés compartidas ni del navegador; el activo `.json` público no la lleva.

Rutas de **lectura** públicas (los datos del portal son públicos): `GET /list-files`, `GET /get-data/:path`, `GET /get-merged-data`, `GET /list-images`, `GET /get-image`, `GET /list-terms` y `GET /healthcheck`. Una lectura nueva se hace pública **a propósito**. `GET /get-data/:path` es una **excepción condicional (12/11/2026, D1)**: desde M25 (30/10/2026) solo lee versiones `.xlsx` y activos `data/active/{provincia}.json` (el resto da 400 sin llamar a S3); la rama de versiones `.xlsx`, que convierte el Excel, exige token y el activo `.json` sigue público (M2 en parte). Se modela con una puerta local, `tokenAuthIfVersionKey` en `routes/data.js`, que es el **primer manejador de la propia ruta** (sin `router.use`) y llama a `tokenAuth` solo si `isValidDataKey(req.params.path)` (el mismo `req.params.path` ya decodificado que usa el manejador, así que un `%2F` no la salta). `tests/estructura-rutas.test.js` la clasifica con un tercer tipo, `version-token` (primer manejador `tokenAuthIfVersionKey` y sin `tokenAuth` en la pila), y `tests/rutas-protegidas.test.js` comprueba el `401` de la versión con los tres estados de token. En `docs/04-api.md` la fila sigue con 🔓 porque `docs-check` lee de forma estática el primer manejador. Una ruta nueva con una puerta condicional así es una excepción que se registra aquí.

### S4. Claves de S3 e inyección

- **Por qué:** casi todas las rutas construyen una clave de S3 con texto que llega del cliente o de un Excel. Una clave inesperada lee, escribe o borra fuera de lo previsto.
- **Regla:** ninguna clave de S3 ni clave de objeto se construye con un valor externo sin **validarlo antes contra una lista de permitidos** (una expresión regular definida una vez en `config/`). Forma de las claves válidas:

| Valor | Forma permitida | Dónde se usa |
|---|---|---|
| Versión de datos | `data/{provincia}/AAAA-MM-DD_vN.xlsx` según la [regla de clave de versión de 06](../06-almacenamiento-s3.md#regla-de-clave-de-versión): `provincia` de letras latinas con diacríticos (cirílico, griego y otros alfabetos se rechazan, M23) separadas por un solo espacio o guion (sin `/`, `.` ni dígitos), hasta 50 caracteres, en NFC, que no sea `active`, `terms`, `drafts`, no empiece por `active`/`terms` en minúsculas ni sea una propiedad de objeto, y hasta 120 caracteres en total | `/update-file`, `/delete-file`, `/get-data` |
| Clave de borrador | `data/drafts/{provincia}/<uuid>.xlsx` según la [regla de clave de borrador de 06](../06-almacenamiento-s3.md#regla-de-clave-de-borrador): UUID en minúsculas generado por el servidor, misma regla de provincia (NFC, sin normalizar) y hasta 120 caracteres; una clave de versión no vale aquí ni una de borrador vale como versión | `/upload/confirm` |
| JSON activo | `data/active/{provincia}.json` (con la misma regla de provincia, en NFC; `isValidGetDataKey` en `functions/validateDataKey.js`, segunda lista de permitidos solo para esta ruta: acepta este activo o una clave de versión; 400 `Invalid path` sin llamar a S3; M25, 30/10/2026) | `/get-data` |
| Imagen | `imageKey` según la [regla de 06](../06-almacenamiento-s3.md#regla-de-imagekey): segmentos de letras, números y marcas combinantes Unicode y `. _ - ( ) +` con `/` simple, hasta 200 caracteres y extensión jpg, jpeg, png, gif o webp | `/get-image`, `/delete-image`, `/upload-image` |

- **Cómo:** hoy no hay comprobación automática; se revisa y se cubrirá con tests de entrada.
- **Estado:** **cumple en parte**. **Cumple para las claves de versión (28/10/2026)**: la provincia del Excel se valida en `POST /upload` (A4 resuelto; `active`, `terms`, `__proto__` y similares dan 400, `Activos` se acepta porque los listados llevan prefijo con barra) y `draftKey` (`isValidDraftKey`) y `fileName` (`isValidDataKey`) se validan en `/upload/confirm`, `/update-file` y `/delete-file` sin normalizarlos (M4 cerrado para esas tres rutas). Desde A2 (29/10/2026) los borradores viven en `data/drafts/` y cada ruta rechaza la clave del otro tipo. `GET /get-data/:path(*)` ya no lee cualquier clave desde M25 (30/10/2026): `isValidGetDataKey` deja pasar solo versiones y activos, y los borradores y el glosario dan 400; desde el 12/11/2026 (D1) las versiones `.xlsx` además exigen token (versiones con token; el activo sigue público). Desde M23 (30/10/2026) la provincia solo admite escritura latina, así que un homoglifo de otro alfabeto da 400. Límites: siguen sin detectarse los confundibles dentro del latín (`I`/`l`, ancho completo, `ª`, `º`, `ɑ`, `ɡ`, `ı`, `ſ`, `ᴀ`), `Málaga`/`Malaga` siguen siendo carpetas distintas y la existencia del objeto no se comprueba. **Sigue sin cumplir del todo**: el activo de `/get-data` sigue siendo público y sin límite (M2 en parte: el `.xlsx` ya exige token; primer paso hecho con M25). **Riesgo aceptado (S15, 30/10/2026)**: `AccessDenied` se lee como «no existe» en dos lecturas públicas, `list-terms` (`[]`) y `get-data` con una clave permitida (404), así que un permiso roto puede pasar inadvertido (la causa queda en el log); las escrituras del glosario no lo toleran y responden 500 sin escribir (A6). `GET /get-image` y `DELETE /delete-image` ya validan `imageKey` (28/10/2026, `isValidImageKey`; riesgo residual aceptado: se pueden firmar objetos no listados bajo `gallery/`); `POST /upload-image` valida desde el 29/10/2026 (M5) el tipo, el título y la firma del contenido, y la clave que construye cumple siempre `isValidImageKey` (`functions/validateImageUpload.js`); los objetos subidos antes pueden tener claves que la regla rechaza (sin migración). El `imageKey` frente al listado real de la galería está **(por confirmar)**.

### S5. Subida de archivos

| Regla | Por qué | Estado |
|---|---|---|
| `multer` con `limits.fileSize` | `memoryStorage` guarda el fichero entero en RAM: un fichero enorme tumba el proceso | Cumple desde el 28/10/2026 (M6): 10 MB en `/upload` y 5 MB en `/upload-image`, máximo aceptado exacto; 400 `File exceeds the maximum allowed size` |
| Se valida la **extensión y el tipo**: para datos (`/upload`), la extensión `.xlsx`, sin comprobar el MIME porque lo manda el cliente; para la galería (`/upload-image`), extensión `jpg`/`jpeg`/`png`/`gif`/`webp`, MIME canónico exacto y firma (magic bytes) del contenido | El backend solo procesa `.xlsx`; el `ContentType` de las imágenes lo fija el backend desde el tipo validado (M5, 29/10/2026). Un fichero con nombre `.xlsx` se carga entero en memoria y `exceljs` lo descomprime sin límite (M9); la ruta exige un token de acceso de Cognito y es solo del administrador. **La conversión también ocurre en `GET /get-data` con una versión `.xlsx`** (12/11/2026, D1), con la misma mitigación (token); un tope previo `buffer.length > MAX_UPLOAD_BYTES` se descartó: con token la ruta queda tan expuesta como `/upload` (cuyo M9 se acepta) y las versiones anteriores a M6 de más de 10 MB, si existen **(por confirmar)**, dejarían de abrirse | **Cumple en parte**: imágenes cumple desde el 29/10/2026 (M5; la firma no sustituye un reprocesado: un polyglot imagen+script con cabecera válida pasa); datos **no cumple** (D3) |
| Un `.xlsx` es un zip: se trata como **no confiable** (zip bomb, libros con millones de filas) | `exceljs` lo carga entero en memoria y no hay límite de descompresión **(por confirmar)** | Sin límites (M9). Mitigado porque solo el administrador sube ficheros |
| El procesamiento pesado sale de la petición si el volumen crece | Una conversión larga bloquea el event loop | M9 |
| Se comprueba que la subida llegó a S3 antes de dar el éxito | Un fallo parcial deja datos a medias | Cumple: se espera a cada `putObject` |

### S6. Entrada HTTP, CORS, cabeceras y correo

| Regla | Por qué | Se comprueba | Estado |
|---|---|---|---|
| CORS con orígenes **exactos** por entorno (`ALLOWED_ORIGIN`: un origen o una lista separada por comas, sin comodín) | Solo el frontend debe poder llamar desde un navegador | `quality` prohíbe `origin: '*'` y `cors()` sin opciones | Cumple |
| Límite del cuerpo JSON explícito | `express.json()` usa el valor por defecto de `body-parser` (100 kb) **(verificado en 1.20.3)**: suficiente hoy, pero implícito | Revisión | Cumple por defecto |
| Cabeceras de seguridad (`helmet`) | Limitan el daño si algo falla (por ejemplo, `nosniff` en las respuestas) | Revisión | **No cumple** (B1) |
| **Límite de peticiones** en los endpoints públicos que cuestan (`/send-email`; valorar `/get-merged-data`) | Sin límite, cualquiera puede agotar la cuota de Gmail o la CPU | Revisión | Cumple en `/send-email` (5 por 15 minutos por IP, M3 resuelto el 28/10/2026; almacén en memoria, IP real tras el proxy **(por confirmar con infra)**). `/get-merged-data` sin límite. `GET /get-data` con `.xlsx` ya no es pública (exige token, 12/11/2026) y no necesita limitador; su activo `.json` no convierte nada |
| **Aviso por correo** de cada alta o baja de un destinatario del formulario de contacto (12/11/2026) | La lista decide quién lee datos personales de los visitantes; el aviso es la única mitigación de C16 en esa ruta | Tests (`tests/destinatarios-rutas.test.js`) | Cumple: va a los destinatarios de la lista **anterior** (o a `EMAIL`), con la dirección **enmascarada** (`a***@dominio`, nunca la local entera; cada carácter `\p{Cf}` sale como `?`, 13/11/2026), texto fijo en español, sin la lista completa ni el autor; no se espera al envío y su fallo no cambia la respuesta |
| `/send-email` valida **todos** los campos: que existan, que sean cadenas, el formato básico de `email`, longitudes máximas y ausencia de caracteres de control | `subject`, `username` y `email` entran en el asunto y en `replyTo`; sin validar pueden colarse saltos de línea o direcciones distintas. `nodemailer` normaliza muchas de estas cosas, pero **no confíes en ello** (por confirmar) | Revisión | Cumple desde el 28/10/2026 (`validateContactMessage`; M3). Desde el 13/11/2026 `email` también rechaza los caracteres Unicode de formato `\p{Cf}` (U+200B, U+202E...; M31). Límites: M33; `username` y `subject` siguen admitiendo controles bidi (M34) |
| `nodemailer` actualizado | El aviso alto de `nodemailer` incluye **inyección de comandos SMTP** y envío a un dominio no previsto, y el destinatario de respuesta (`replyTo`) sale del usuario | `npm run quality` | **No cumple** (M16) |
| Sin ejecución de código ni de procesos a partir de la entrada | Es la vulnerabilidad más grave posible | `quality` y ESLint prohíben `eval`, `new Function` y `child_process` en el código de la API (los scripts de `scripts/` son herramientas de desarrollo y quedan fuera: `quality-check` lanza la suite con `runWithTimeout` de `scripts/lib/repo.mjs`, que al agotarse el tiempo máximo mata el árbol de procesos y no deja huérfanos, M24 b; `docs-check` falla si `index.js` declara rutas, M24 a) | Cumple **(verificado)** |
| Sin peticiones del servidor a URLs que da el cliente | Evita SSRF | Revisión | Cumple: el servidor solo habla con S3 y SMTP **(verificado)** |

### S7. S3 e IAM

| Regla | Estado |
|---|---|
| Mínimo privilegio: el rol de Beanstalk solo tiene `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` y `s3:ListBucket` sobre el bucket de la aplicación | Cumple **(verificado en `sigmetum-infra/modules/storage/main.tf`)**; es lo que usa el código |
| El bucket **no es público** (`aws_s3_bucket_public_access_block`), tiene **cifrado** en reposo y **versionado** | Cumple **(verificado en `sigmetum-infra`)**; por confirmar que los dos entornos están aplicados |
| Las imágenes se sirven con **URLs prefirmadas de caducidad corta** (3600 s) y no con un bucket público | Cumple. Una URL filtrada sirve hasta que caduca (D9) |
| Un permiso nuevo de S3 se justifica y se pide en `sigmetum-infra` | Skill `s3-operation-review` |
| Credenciales: en local, perfil SSO (`AWS_PROFILE`); en Beanstalk, el rol de la instancia. **Nunca** `AWS_ACCESS_KEY_ID` ni `AWS_SECRET_ACCESS_KEY` | Cumple |
| El nombre del bucket sale de `AWS_BUCKET_NAME`, nunca de un literal | Cumple |

### S8. Errores y registros

- **Por qué:** un error revela cómo está hecho el sistema; un log lo leen más personas de las que crees.
- **Reglas:**
  - Sin trazas de pila en producción: solo en local (`isDev` en `errorHandler`). Cumple.
  - Los mensajes al cliente son **controlados**. **Cumple (M17 y M22, 28/10/2026):** `errorHandler` solo devuelve textos fijos o mapeados (`Internal server error` para todo lo no mapeado; `Invalid JSON`, `Payload too large`, `Bad request`, `Token expired`, etc.); el `err.message` real queda en la consola. Un `Origin` no permitido responde `403` `Origin not allowed` sin el origen; el origen rechazado se registra con `console.warn('CORS: origin not allowed:', JSON.stringify(origin.slice(0, 200)))` (el origen se trunca a 200 caracteres y `JSON.stringify` neutraliza saltos de línea y comillas de un valor que controla el cliente) y no se devuelve. Los mapeados de almacenamiento (`NoSuchKey`, `NoSuchBucket`, `AccessDenied`, `NetworkingError` / `ECONNREFUSED`) conservan su texto por decisión (28/10/2026): revelan al cliente el tipo de fallo de almacenamiento, no datos de la petición. Textos de `AccessDenied` en el glosario (S15): `upload-term` y `delete-term` dan `Access denied to storage` si el error trae `Code` y `Internal server error` si solo trae `name`; `GET /get-data` con `AccessDenied` da el texto fijo de 404 `The requested file does not exist in storage`.
  - Nada sensible en los logs (ver S1). `morgan('combined')` registra método, URL completa, IP, `User-Agent` y `Referer`, pero no cabeceras de autenticación ni cuerpos: por eso **los tokens no pueden ir en la URL**.
  - **Registros fijos de la lista de destinatarios (12/11/2026):** `[recipients] change notice not sent` (aviso de cambio que falló, sin `err.message` ni direcciones: el `reason` podría llevar correos del personal) y `[send-email] recipient list unavailable, using EMAIL:` más solo el `name` del error (lista ilegible o sin respuesta en 4 s, con `TimeoutError`; el mensaje cae a `EMAIL`). Los `400` y `404` de las rutas nuevas son fijos y no reflejan el correo recibido; `maskEmail` sustituye los `\p{Cf}` por `?` para que el aviso no reproduzca caracteres invisibles ni de inversión de texto (M31).
  - `console.error(..., error)` con el objeto del SDK: aceptable hoy; no añadas datos de la petición.

### S9. Dependencias

- **Por qué:** el código de terceros es casi todo lo que se ejecuta.
- **Cómo:** `npm run quality` ejecuta `npm audit --omit=dev` (la CI añade `npm audit --audit-level=high` sobre todas las dependencias, incluidas las de desarrollo como `supertest`) y **falla con vulnerabilidades altas o críticas** que no estén aceptadas por escrito en `ACCEPTED_ADVISORIES` (`scripts/quality-check.mjs`); las demás se cuentan como aviso. También falla si una excepción ya no hace falta.
- **Reglas:**
  - Se confirma `package-lock.json` y se instala con `npm ci`.
  - Se corrige con `npm audit fix`, **nunca con `--force`** (subiría `nodemailer` a otra versión mayor sin avisar).
  - **Solo se acepta** lo que no es alcanzable en producción o no tiene arreglo, con la justificación escrita. Que exista un arreglo con cambios mayores **no** es motivo para aceptar un aviso alcanzable.
  - Antes de añadir una librería: mantenimiento, licencia, tamaño y que funcione con Node 22 (`engines` de `package.json`).
- **Excepciones vigentes** (en `ACCEPTED_ADVISORIES`): ninguna. Las tres que había (`tar`, `@mapbox/node-pre-gyp`, `brace-expansion`) venían de la instalación de `bcrypt`, retirada el 09/11/2026.
- **Avisos de producción:** sin excepciones aceptadas (`ACCEPTED_ADVISORIES` vacío). M16 y M20 están resueltos; solo queda el moderado de `uuid` vía `exceljs` (M20), cuyo único arreglo exige `--force`. `npm audit fix` resuelve lo que no exige un cambio mayor.

### S10. Privacidad

- El formulario de contacto recoge nombre y correo y los envía por email: no los guarda ni los registra **(verificado)**. `morgan` sí registra la IP (por confirmar si debe tratarse como dato personal).
- **Destinatarios del formulario de contacto (12/11/2026).** El bucket guarda ahora correos del personal en `data/contact/recipients.json` (dato personal; las respuestas de `GET /list-recipients` exigen token). **`/send-email` envía un solo correo con `to` en array: los destinatarios se ven entre sí y `replyTo` se mantiene** (si se quitara, «Responder» iría a `EMAIL` y el visitante no recibiría respuesta). **Riesgo aceptado por el usuario:** quien reciba la respuesta de un destinatario con «Responder a todos» —incluido el visitante, si un destinatario la usa— verá hasta 4 direcciones del personal. **Mitigación:** pedir a los destinatarios que usen «Responder», no «Responder a todos». El mensaje del visitante sigue sin guardarse ni registrarse.
- La información sobre el tratamiento de datos es del frontend y del servicio jurídico de la universidad, no de esta API **(por confirmar)**.

## 3. Mapa a OWASP API Security Top 10 (edición 2023)

Solo nombres de categoría; el detalle de cada riesgo está en la fuente.

| Categoría | Reglas y hallazgos relacionados |
|---|---|
| API1 Broken Object Level Authorization | S4 (`/get-data` solo lee versiones y activos válidos; las versiones `.xlsx` con token desde el 12/11/2026 y el activo sigue público: M2 en parte), S3 |
| API2 Broken Authentication | S2 (B8, C16, M12, M15) |
| API3 Broken Object Property Level Authorization | S6 y la respuesta de `POST /upload` (D8) |
| API4 Unrestricted Resource Consumption | S5 (M6, M9; la conversión de `get-data` `.xlsx` va con token), S6 (M3, M12) |
| API5 Broken Function Level Authorization | S3 (rutas mutantes protegidas) |
| API6 Unrestricted Access to Sensitive Business Flows | S6 (`/send-email`: M3) |
| API7 Server Side Request Forgery | S6 (no hay peticiones a URLs del cliente) |
| API8 Security Misconfiguration | S6 (B1), S8 (M17 y M22, resueltos), S9, M12 |
| API9 Improper Inventory Management | Prefijo `/api/v1`, inventario en [04](../04-api.md) y versionado ([buenas prácticas](buenas-practicas-backend.md#9-versionado-de-la-api)) |
| API10 Unsafe Consumption of APIs | S5 y S7: lo que se lee de S3 se trata como entrada (A6); SMTP y AWS SDK (M16) |

## 4. Estado actual (auditoría del 30/09/2026)

| Comprobación | Resultado |
|---|---|
| `eval`, `new Function`, `child_process` en el código | **Ninguno** |
| Secretos, JWT o hashes bcrypt literales en código, `.env.example`, documentación y `.claude/` | **Ninguno** |
| `.env` versionado / `package-lock.json` versionado | **No** / **Sí** |
| Rutas que modifican estado sin autenticación | Solo `POST /send-email` (las tres rutas de destinatarios son protegidas, con `tokenAuth` primero y limitador en las escrituras) (excepción registrada; `POST /log` se retiró el 09/11/2026) |
| Variables de entorno que usa el código y no están declaradas | **Ninguna** |
| `npm audit` de producción (alta o crítica) | **Pasa**: sin avisos altos o críticos y sin excepciones aceptadas. Solo queda el moderado de `uuid` vía `exceljs` (M20) |
| ESLint | Sin errores; avisos en el tope (ver [buenas prácticas](buenas-practicas-backend.md#14-eslint-y-el-tope-de-avisos)) |
| Autenticación | Solo tokens de acceso de Cognito, RS256 fijo (S2); el login propio ya no existe (A7 sin objeto); C16 aceptado con registro cerrado |
| `trust proxy`, `helmet`, límite de `multer`, límite en `/send-email` | `trust proxy` (configurable con `TRUST_PROXY_HOPS`, valor real por confirmar con infra) y el límite de `/send-email` configurados; `helmet` no (B1); el límite de `multer` configurado desde el 28/10/2026 (M6) |
| Validación de la entrada de las rutas | Parcial: ver la tabla de [buenas prácticas](buenas-practicas-backend.md#4-validación-de-entrada) |
| `errorHandler` y mensajes al cliente | Sin trazas en producción; mensajes fijos o mapeados, sin `err.message` (M17, resuelto el 28/10/2026); CORS rechazado como `403` sin el origen (M22) |
| Bucket: acceso público bloqueado, cifrado y versionado; IAM mínimo | Sí **(verificado en `sigmetum-infra`)** |
| Declaración de Node (`engines`) | No está (B3) |

## 5. Lista de comprobación para una PR

Márcala **siempre** que el cambio toque autenticación, rutas, subida de archivos, S3, CORS, correo, dependencias, secretos o logs.

- [ ] `npm run lint`, `npm run quality` y `npm run docs:check` en verde.
- [ ] Toda ruta nueva que modifica estado lleva `tokenAuth` como primer manejador; si es pública, está justificada en `PUBLIC_MUTATING_ROUTES` y en la tabla de S3.
- [ ] Toda entrada (cuerpo, parámetros, consulta, `req.file`) se valida en tipo y forma **antes** de usarse; ninguna clave de S3 se construye con un valor sin validar.
- [ ] Todo manejador `async` captura sus errores y llama a `next(error)`.
- [ ] No se escribe ningún dato sensible en un log, ni se devuelve `err.message` de un error interno al cliente.
- [ ] Las dependencias nuevas están justificadas, funcionan con Node 20 y `npm audit` no empeora. Ninguna excepción nueva en `ACCEPTED_ADVISORIES` sin motivo escrito.
- [ ] No se añaden secretos ni valores reales a `.env.example` ni a la documentación.
- [ ] Un permiso nuevo de S3 se pide en `sigmetum-infra` con el mínimo privilegio.
- [ ] Si se toca el contrato con el frontend o la infra, se actualiza la documentación y se avisa en la PR ([mantenimiento.md](mantenimiento.md#6-avisar-al-frontend-y-a-la-infraestructura)).
- [ ] Para cambios de autenticación, subida de archivos o S3: se pasa además la revisión `/security-review` de Claude Code.

## 6. Si encuentras una vulnerabilidad

1. No la publiques en un issue ni en una PR abierta: díselo directamente a quien mantiene el proyecto.
2. Si hay un secreto expuesto (clave, token, contraseña), **se rota primero** y después se limpia el historial. El backend ya no tiene secreto de firma de sesiones: las claves de los tokens son de Cognito.
3. Se corrige con un test que la reproduzca.
4. Se anota en [07](../07-estado-y-deuda-tecnica.md) una vez resuelta, sin detalles que faciliten reproducirla.

## 7. Mantener esta guía

- Cada vez que se acepta o se retira una vulnerabilidad de `ACCEPTED_ADVISORIES`, se actualiza la tabla de la regla S9.
- Cada vez que cambia algo del estado (S2 a S8), se actualiza la tabla de la sección 4 y la fila de la regla.
- Una excepción de `PUBLIC_MUTATING_ROUTES` nueva se añade también a la tabla de S3.
- Una comprobación manual que se pueda automatizar se pasa a ESLint o a `scripts/quality-check.mjs`.
