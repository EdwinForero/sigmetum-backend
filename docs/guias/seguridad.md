# Seguridad de la API

Normas para no introducir vulnerabilidades en este repositorio, con el estado real de cada una. Cada regla dice **por qué**, **cómo se comprueba** y **cómo está hoy**.

- Complementa a [buenas-practicas-backend.md](buenas-practicas-backend.md). El procedimiento de revisión paso a paso está en la skill `.claude/skills/security-pre-merge`; las normas y su motivo, aquí.
- Lo que depende de la infraestructura está en `sigmetum-infra`; lo que depende del frontend, en `../sigmetum-frontend/docs/integracion/para-backend.md`.
- Los hallazgos con id (A, M, B, D, I) están en [07](../07-estado-y-deuda-tecnica.md). Esta guía **no los repite**: los referencia y los convierte en reglas.
- Si un cambio contradice una regla de esta guía, **avisa y pregunta** antes de hacerlo.
- Marcas de certeza: **(verificado)** lo comprobado contra el código, ejecutándolo o en `sigmetum-infra`; **(por confirmar)** lo deducido.

## 1. Qué hay que proteger

| Activo | Riesgo principal |
|---|---|
| **Sesión del administrador** (JWT firmado con `JWT_SECRET`) | Que alguien firme o reutilice un token; que se adivine o fuerce el login |
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
| `ADMIN_PASSWORD` contiene un **hash bcrypt**, nunca la contraseña en claro | `userAuth` hace `bcrypt.compare`: con un valor que no sea un hash, **todos los logins dan 401** sin avisar | Revisión | **No se valida al arrancar** (M15). Cómo generarlo: [03](../03-configuracion.md#generar-el-hash-de-admin_password) |
| `JWT_SECRET` es largo y aleatorio (al menos 32 bytes; por ejemplo `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`), **distinto por entorno** | Con un secreto corto se pueden falsificar tokens por fuerza bruta | Revisión | `validateEnv` solo comprueba que exista (M15). La fortaleza de los valores reales **(por confirmar)** |
| **Rotación** de `JWT_SECRET`: al sospechar una filtración o cuando cambie quien lo conoce | Cambiarlo invalida todos los tokens, lo que con un único administrador es aceptable | Revisión | Sin procedimiento escrito |
| Los tokens **caducan** (`JWT_EXPIRATION`, `8h` en el ejemplo) y el valor es el mínimo útil | Un token robado deja de servir | `validateEnv` exige la variable | Cumple |
| `jwt.verify` fija el algoritmo (`algorithms: ['HS256']`) | No depender del valor por defecto de la librería | Revisión | **No cumple** (B8) |
| El login tiene **límite de intentos** y `trust proxy` bien configurado | Detrás del ALB, sin `trust proxy`, todos los clientes comparten una IP y el mismo contador: cualquiera puede bloquear el login del administrador | `routes/auth.js` | Límite de 10 intentos cada 15 minutos. **Falta `trust proxy`** (M12, por confirmar en el despliegue). La opción `max` está obsoleta (B6) |
| Un manejador de login **no puede quedarse colgado** | Quien conoce el usuario puede agotar conexiones enviando peticiones sin contraseña | Test (cuando existan) | **No cumple**: `userAuth` sin `try/catch` deja la petición sin respuesta **(verificado ejecutándolo)** (A7) |
| Mensaje único para usuario y contraseña incorrectos | No revela qué usuarios existen | Revisión | Cumple (`Invalid credentials`) |
| Las dependencias de autenticación están al día | `jsonwebtoken` depende de `jws`, con un aviso alto sobre la verificación de firmas HMAC | `npm run quality` | **No cumple** (M16); el alcance real del aviso, **por confirmar** |

### S3. Autorización

- **Por qué:** `tokenAuth` es la única barrera. Hay un solo rol: cualquier token válido es el administrador.
- **Reglas:** toda ruta `POST`, `PUT`, `PATCH` o `DELETE` cuelga de `protectedRouter` (o lleva `tokenAuth`). Una ruta pública que modifica estado es una **excepción registrada y justificada**.
- **Cómo:** `npm run quality` falla con una ruta mutante sin autenticación que no esté en `PUBLIC_MUTATING_ROUTES` (y con una excepción que ya no exista).
- **Estado:** cumple **(verificado)**. Excepciones vigentes:

| Ruta | Por qué es pública | Condición para mantenerla |
|---|---|---|
| `POST /log` | Es el login | Límite de intentos y arreglar A7 y M12 |
| `POST /send-email` | Formulario de contacto | Límite de peticiones y validación (M3). Hoy no los tiene |

Rutas de **lectura** públicas (los datos del portal son públicos): `GET /list-files`, `GET /get-data/:path`, `GET /get-merged-data`, `GET /list-images`, `GET /get-image`, `GET /list-terms` y `GET /healthcheck`. Una lectura nueva se hace pública **a propósito**. `GET /get-data/:path` es la excepción problemática: lee cualquier clave del bucket (M2, y D1 antes de cerrarlo).

### S4. Claves de S3 e inyección

- **Por qué:** casi todas las rutas construyen una clave de S3 con texto que llega del cliente o de un Excel. Una clave inesperada lee, escribe o borra fuera de lo previsto.
- **Regla:** ninguna clave de S3 ni clave de objeto se construye con un valor externo sin **validarlo antes contra una lista de permitidos** (una expresión regular definida una vez en `config/`). Forma de las claves válidas:

| Valor | Forma permitida | Dónde se usa |
|---|---|---|
| Versión de datos | `data/{provincia}/AAAA-MM-DD_vN.xlsx`, con `provincia` sin `/`, distinta de `active`, `terms` y `__proto__` | `/update-file`, `/delete-file`, `/upload/confirm`, `/get-data` |
| JSON activo | `data/active/{provincia}.json` | `/get-data` |
| Imagen | Un nombre simple (sin `/`) bajo `gallery/` | `/get-image`, `/delete-image`, `/upload-image` |

- **Cómo:** hoy no hay comprobación automática; se revisa y se cubrirá con tests de entrada.
- **Estado:** **no cumple**. `provincia` sale de la primera fila del Excel: un valor `active` o `terms` escribe dentro de `data/active/`, y `__proto__` rompe `GET /list-files` con un `TypeError` **(verificado ejecutándolo)** (A4). `fileName` no se valida en `/update-file` ni `/delete-file` (M4). `/get-data` lee cualquier clave (M2). El `title` de las imágenes solo sustituye espacios (M5).

### S5. Subida de archivos

| Regla | Por qué | Estado |
|---|---|---|
| `multer` con `limits.fileSize` | `memoryStorage` guarda el fichero entero en RAM: un fichero enorme tumba el proceso | **No cumple** (M6) |
| Se valida la **extensión y el tipo**: `.xlsx` para datos; `image/jpeg`, `image/png`, `image/webp` para la galería | El backend solo procesa `.xlsx`; el `ContentType` de las imágenes lo pone el cliente | **No cumple** (D3, M5) |
| Un `.xlsx` es un zip: se trata como **no confiable** (zip bomb, libros con millones de filas) | `exceljs` lo carga entero en memoria y no hay límite de descompresión **(por confirmar)** | Sin límites (M9). Mitigado porque solo el administrador sube ficheros |
| El procesamiento pesado sale de la petición si el volumen crece | Una conversión larga bloquea el event loop | M9 |
| Se comprueba que la subida llegó a S3 antes de dar el éxito | Un fallo parcial deja datos a medias | Cumple: se espera a cada `putObject` |

### S6. Entrada HTTP, CORS, cabeceras y correo

| Regla | Por qué | Se comprueba | Estado |
|---|---|---|---|
| CORS con **un único origen** por entorno (`ALLOWED_ORIGIN`) | Solo el frontend debe poder llamar desde un navegador | `quality` prohíbe `origin: '*'` y `cors()` sin opciones | Cumple |
| Límite del cuerpo JSON explícito | `express.json()` usa el valor por defecto de `body-parser` (100 kb) **(verificado en 1.20.3)**: suficiente hoy, pero implícito | Revisión | Cumple por defecto |
| Cabeceras de seguridad (`helmet`) | Limitan el daño si algo falla (por ejemplo, `nosniff` en las respuestas) | Revisión | **No cumple** (B1) |
| **Límite de peticiones** en los endpoints públicos que cuestan (`/send-email`; valorar `/get-merged-data`) | Sin límite, cualquiera puede agotar la cuota de Gmail o la CPU | Revisión | Solo el login lo tiene (M3) |
| `/send-email` valida **todos** los campos: que existan, que sean cadenas, el formato de `email` y longitudes máximas | `subject`, `username` y `email` entran en el asunto y en `replyTo`; sin validar pueden colarse saltos de línea o direcciones distintas. `nodemailer` normaliza muchas de estas cosas, pero **no confíes en ello** (por confirmar) | Revisión | **No cumple** (M3) |
| `nodemailer` actualizado | El aviso alto de `nodemailer` incluye **inyección de comandos SMTP** y envío a un dominio no previsto, y el destinatario de respuesta (`replyTo`) sale del usuario | `npm run quality` | **No cumple** (M16) |
| Sin ejecución de código ni de procesos a partir de la entrada | Es la vulnerabilidad más grave posible | `quality` y ESLint prohíben `eval`, `new Function` y `child_process` | Cumple **(verificado)** |
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
  - Los mensajes al cliente son **controlados**. **No cumple:** `errorHandler` devuelve `err.message` de cualquier error no mapeado (por ejemplo, un `JSON.parse` fallido o un error del SDK) también en producción (M17).
  - Nada sensible en los logs (ver S1). `morgan('combined')` registra método, URL completa, IP, `User-Agent` y `Referer`, pero no cabeceras de autenticación ni cuerpos: por eso **los tokens no pueden ir en la URL**.
  - `console.error(..., error)` con el objeto del SDK: aceptable hoy; no añadas datos de la petición.

### S9. Dependencias

- **Por qué:** el código de terceros es casi todo lo que se ejecuta.
- **Cómo:** `npm run quality` ejecuta `npm audit --omit=dev` y **falla con vulnerabilidades altas o críticas** que no estén aceptadas por escrito en `ACCEPTED_ADVISORIES` (`scripts/quality-check.mjs`); las demás se cuentan como aviso. También falla si una excepción ya no hace falta.
- **Reglas:**
  - Se confirma `package-lock.json` y se instala con `npm ci`.
  - Se corrige con `npm audit fix`, **nunca con `--force`** (subiría `nodemailer` a otra versión mayor sin avisar).
  - **Solo se acepta** lo que no es alcanzable en producción o no tiene arreglo, con la justificación escrita. Que exista un arreglo con cambios mayores **no** es motivo para aceptar un aviso alcanzable.
  - Antes de añadir una librería: mantenimiento, licencia, tamaño y que funcione con Node 20.
- **Excepciones vigentes** (en `ACCEPTED_ADVISORIES`):

| Dependencia | Gravedad | Por qué se acepta |
|---|---|---|
| `tar` | Crítica | Solo la usa `@mapbox/node-pre-gyp`, que `bcrypt` ejecuta al **instalar** para descargar su binario. No se carga en ejecución |
| `@mapbox/node-pre-gyp` | Alta | Herramienta de instalación de `bcrypt`. No se carga en ejecución |
| `brace-expansion` | Alta | Llega por `minimatch`, en la instalación de `bcrypt` y en `archiver` (que usa `exceljs` al escribir `.xlsx`). Los patrones son internos y no hay entrada del usuario (por confirmar en `exceljs`) |

- **Sin aceptar, alcanzables en producción (M16):** `express` y `path-to-regexp`, `jws` (vía `jsonwebtoken`), `nodemailer`, `fast-xml-parser` (vía el SDK de AWS) e `ip-address` (vía `express-rate-limit`). La puerta de calidad **falla** por ellas hasta que se actualicen. `npm audit fix` resuelve las que no exigen un cambio mayor; `nodemailer` sí lo exige.

### S10. Privacidad

- El formulario de contacto recoge nombre y correo y los envía por email: no los guarda ni los registra **(verificado)**. `morgan` sí registra la IP (por confirmar si debe tratarse como dato personal).
- La información sobre el tratamiento de datos es del frontend y del servicio jurídico de la universidad, no de esta API **(por confirmar)**.

## 3. Mapa a OWASP API Security Top 10 (edición 2023)

Solo nombres de categoría; el detalle de cada riesgo está en la fuente.

| Categoría | Reglas y hallazgos relacionados |
|---|---|
| API1 Broken Object Level Authorization | S4 (`/get-data` lee cualquier clave: M2), S3 |
| API2 Broken Authentication | S2 (A7, M12, M15, B8, M16) |
| API3 Broken Object Property Level Authorization | S6 y la respuesta de `POST /upload` (D8) |
| API4 Unrestricted Resource Consumption | S5 (M6, M9), S6 (M3, M12) |
| API5 Broken Function Level Authorization | S3 (rutas mutantes protegidas) |
| API6 Unrestricted Access to Sensitive Business Flows | S6 (`/send-email`: M3) |
| API7 Server Side Request Forgery | S6 (no hay peticiones a URLs del cliente) |
| API8 Security Misconfiguration | S6 (B1), S8 (M17), S9, M12 |
| API9 Improper Inventory Management | Prefijo `/api/v1`, inventario en [04](../04-api.md) y versionado ([buenas prácticas](buenas-practicas-backend.md#9-versionado-de-la-api)) |
| API10 Unsafe Consumption of APIs | S5 y S7: lo que se lee de S3 se trata como entrada (A6); SMTP y AWS SDK (M16) |

## 4. Estado actual (auditoría del 30/09/2026)

| Comprobación | Resultado |
|---|---|
| `eval`, `new Function`, `child_process` en el código | **Ninguno** |
| Secretos, JWT o hashes bcrypt literales en código, `.env.example`, documentación y `.claude/` | **Ninguno** |
| `.env` versionado / `package-lock.json` versionado | **No** / **Sí** |
| Rutas que modifican estado sin autenticación | Solo `POST /log` y `POST /send-email` (excepciones registradas) |
| Variables de entorno que usa el código y no están declaradas | **Ninguna** |
| `npm audit` de producción (alta o crítica) | **Falla**: `express`, `path-to-regexp`, `jws`, `nodemailer`, `fast-xml-parser` e `ip-address` sin aceptar (M16). `tar`, `@mapbox/node-pre-gyp` y `brace-expansion` aceptadas |
| ESLint | Sin errores; avisos en el tope (ver [buenas prácticas](buenas-practicas-backend.md#14-eslint-y-el-tope-de-avisos)) |
| Login con el usuario correcto y sin contraseña | La petición **no recibe respuesta** (A7) |
| `trust proxy`, `helmet`, límite de `multer`, límite en `/send-email` | Ninguno configurado (M12, B1, M6, M3) |
| Validación de la entrada de las rutas | Parcial: ver la tabla de [buenas prácticas](buenas-practicas-backend.md#4-validación-de-entrada) |
| `errorHandler` y mensajes al cliente | Sin trazas en producción; devuelve `err.message` sin filtrar (M17) |
| Bucket: acceso público bloqueado, cifrado y versionado; IAM mínimo | Sí **(verificado en `sigmetum-infra`)** |
| Declaración de Node (`engines`) | No está (B3) |

## 5. Lista de comprobación para una PR

Márcala **siempre** que el cambio toque autenticación, rutas, subida de archivos, S3, CORS, correo, dependencias, secretos o logs.

- [ ] `npm run lint`, `npm run quality` y `npm run docs:check` en verde.
- [ ] Toda ruta nueva que modifica estado cuelga de `protectedRouter`; si es pública, está justificada en `PUBLIC_MUTATING_ROUTES` y en la tabla de S3.
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
2. Si hay un secreto expuesto (clave, token, contraseña, `JWT_SECRET`), **se rota primero** y después se limpia el historial. Rotar `JWT_SECRET` invalida todos los tokens.
3. Se corrige con un test que la reproduzca.
4. Se anota en [07](../07-estado-y-deuda-tecnica.md) una vez resuelta, sin detalles que faciliten reproducirla.

## 7. Mantener esta guía

- Cada vez que se acepta o se retira una vulnerabilidad de `ACCEPTED_ADVISORIES`, se actualiza la tabla de la regla S9.
- Cada vez que cambia algo del estado (S2 a S8), se actualiza la tabla de la sección 4 y la fila de la regla.
- Una excepción de `PUBLIC_MUTATING_ROUTES` nueva se añade también a la tabla de S3.
- Una comprobación manual que se pueda automatizar se pasa a ESLint o a `scripts/quality-check.mjs`.
