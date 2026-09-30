# Buenas prácticas del backend

Normas de trabajo para escribir código en este repositorio. No son teoría general: cada regla sale del código actual o de un fallo que ya hemos encontrado, e indica **por qué**, **cómo se comprueba** y **en qué estado está hoy**.

- Seguridad: [seguridad.md](seguridad.md). Qué documentar después de cada cambio: [mantenimiento.md](mantenimiento.md).
- Los hallazgos con id (A, M, B, D, I) están en [07](../07-estado-y-deuda-tecnica.md).
- Las normas y su motivo viven aquí; el procedimiento paso a paso, en las skills de `.claude/skills/`, que enlazan a las secciones de esta guía.
- Si una regla choca con lo que te piden, **avisa y pregunta** antes de saltártela.
- Marcas de certeza: **(verificado)** lo comprobado contra el código o ejecutándolo; **(por confirmar)** lo deducido.

## 1. Definición de terminado

Un cambio está terminado cuando pasan estos comandos y la documentación está al día:

| Comando | Comprueba |
|---|---|
| `npm run lint` | ESLint 9: sin errores y sin superar el tope de avisos |
| `npm run quality` | Patrones prohibidos, rutas mutantes sin autenticación, variables sin declarar, secretos, `npm audit` de producción y ESLint |
| `npm run docs:check` | Que la documentación sigue al código |
| `npm test` | Tests, **cuando existan** (hoy es el placeholder de `npm init`: M11) |

## 2. Estructura: qué va en cada sitio

| Carpeta | Va aquí | No va aquí | Estado |
|---|---|---|---|
| `routes/` | La capa HTTP: leer y **validar** la entrada, llamar a la lógica, dar forma a la respuesta, `next(error)` | Lógica de negocio, acceso directo a S3 | Las rutas llaman a `aws/` y a `functions/`. `POST /upload` concentra bastante orquestación (conversión, versión, dos subidas) |
| `functions/` | Lógica **pura y probable**: recibe datos y devuelve datos (`convertExcelToJson`, `formatFileName`) | Llamadas a S3, lectura de `process.env` al cargar el módulo, `Date` sin poder inyectarla | **No cumple del todo**: `getNextVersion` llama a S3 (M14) y `formatFileName` usa `new Date()` (A1). `tokenAuthentication.js` es un middleware y `userAuthentication.js` un manejador de ruta (B7) |
| `aws/` | **La única capa que habla con S3**: leer, escribir, listar, borrar, firmar URLs | Decisiones de negocio (qué versión activar, cuándo reconvertir un Excel) | **No cumple**: `deleteFileFromS3` y `updateFileS3` contienen la regla "la versión activa es la última" y llaman a `convertExcelToJson` (M14) |
| `config/` | Constantes de rutas de S3 (`s3Paths.js`) y validación del entorno (`validateEnv.js`) | Lógica | Cumple |
| `middleware/` | Middlewares transversales (hoy, `errorHandler`) | Manejadores de una ruta concreta | `tokenAuth` vive en `functions/` (B7) |
| `index.js` | Arranque: entorno, middlewares, montaje de rutas | Lógica. Además arranca el servidor al importarse, lo que impide probarlo con `supertest` | M13 |

Reglas de dependencia: `routes → functions / aws / config`, `aws → config`, `functions → (nada de infraestructura)`. Una capa inferior **no importa** de una superior.

Nombres: archivos en `camelCase` (`awsS3connect.js` es la excepción con minúscula en `connect`); código y commits en inglés; mensajes de error al cliente en inglés (es lo que ya hace la API).

## 3. Contrato de respuesta y errores

| Regla | Por qué | Se comprueba | Estado |
|---|---|---|---|
| Toda ruta responde `{ success: true, data }` o `{ success: false, error }` | El frontend solo considera éxito `response.ok` **y** `success === true` (contrato en `../sigmetum-frontend/docs/integracion/para-backend.md`) | Revisión; `docs:check` comprueba la documentación | Cumple |
| Los fallos inesperados se pasan con `next(error)` a `middleware/errorHandler.js`; las validaciones de entrada responden 400 directamente | Un único sitio da forma a los errores y decide qué se loguea | Skill `new-endpoint` | Cumple en las rutas de S3 y de contenido |
| **Todo manejador `async` captura sus errores** (`try/catch` + `next`) | Express 4 **no** captura las promesas rechazadas: la petición se queda colgada y el error acaba en `unhandledRejection` | Revisión | **No cumple**: `userAuth` no tiene `try/catch`. Con el usuario correcto y sin contraseña, `bcrypt.compare` rechaza y la petición no recibe respuesta **(verificado ejecutándolo)** (A7) |
| Códigos HTTP correctos: **400** entrada inválida, **401** sin token o token inválido, **404** recurso inexistente, **429** límite de peticiones, **500** solo fallos propios | El frontend y quien use la API distinguen el caso por el código | Tests de cada ruta (cuando existan) | **No cumple**: `POST /upload` sin fichero da 500 (A3); `NoSuchKey` de S3 da 500 porque el error del SDK no trae `status` (B9, por confirmar) |
| El mensaje de error al cliente es **controlado**, no `err.message` tal cual | Un error interno puede revelar rutas, claves o nombres de librerías | Revisión de `errorHandler.js` | **No cumple**: `friendlyMessage` devuelve `err.message` para cualquier error no mapeado, también en producción (M17) |
| No cambies la forma de una respuesta sin revisar el contrato con el frontend | Rompe la web sin avisar | [mantenimiento.md](mantenimiento.md), sección 6 | — |
| Los mensajes de la API se añaden en inglés y estables. Si el frontend necesita distinguirlos, se acuerda un `code` | El frontend **no muestra** el texto del servidor | Revisión | Hoy no existe `code` |

## 4. Validación de entrada

**Regla:** toda ruta valida **todo** lo que lee del cliente antes de usarlo: cuerpo (existencia **y tipo**), parámetros de ruta, consulta, `req.file` y cabeceras. Una entrada inválida responde **400** con un mensaje claro y **nunca llega a S3**.

| Por qué | Se comprueba |
|---|---|
| Hoy una entrada rara acaba en un `TypeError` (500) o, peor, en una clave de S3 inesperada | Revisión y tests de 400 por ruta (cuando existan). La lista de comprobación está en la skill `new-endpoint` |

Qué validar y dónde, con el estado real de cada ruta:

| Ruta | Entrada | Valida hoy | Falta |
|---|---|---|---|
| `POST /log` | `username`, `password` | Comprueba usuario y contraseña | Que sean cadenas. Sin `password` la petición se cuelga (A7) |
| `POST /upload` | `file` (multipart) | Nada | Que exista, que sea `.xlsx`, tamaño máximo (A3, D3, M6); la provincia del Excel (A4) |
| `POST /upload/confirm` | `draftKey`, `confirmed` | `draftKey` presente | Que `draftKey` tenga el formato `data/{provincia}/AAAA-MM-DD_vN.xlsx` y que `confirmed` sea booleano (M4) |
| `POST /update-file`, `POST /delete-file` | `fileName` | Nada | Existencia, tipo y formato de clave (M4). Sin `fileName`, `filePath.split` lanza `TypeError` (500) |
| `GET /get-data/:path(*)` | `path` | Nada | Restringir a `data/active/` (M2) |
| `GET /get-image` | `imageKey` | Nada | Que exista y sea un nombre simple. Sin él se firma la clave `gallery/undefined` y responde 200 con una URL que dará 404 |
| `POST /upload-image` | `file`, `title` | Ambos presentes | Tipo MIME y extensión, tamaño, saneo completo del título (M5, M6) |
| `DELETE /delete-image` | `imageKey` | Presente | Que sea un nombre simple |
| `POST /upload-term`, `DELETE /delete-term` | `term` | Presente y no vacío | Que sea una cadena (con un número, `term.trim()` lanza `TypeError` y responde 500) y longitud máxima |
| `POST /send-email` | `username`, `email`, `subject`, `message` | Nada | Que existan, sean cadenas, formato de correo y longitudes. Sin campos se envía un correo con "undefined" (M3) |

Cómo validar: **una función de validación por forma de entrada**, con una lista de permitidos (no de prohibidos), sin dependencias nuevas salvo que compense (ver sección 12). Las expresiones regulares de claves de S3 y de nombres de fichero se definen **una vez** en `config/` y las usan la ruta y los tests.

## 5. S3: una sola convención

| Regla | Por qué | Se comprueba | Estado |
|---|---|---|---|
| Las funciones de `aws/` **lanzan** ante un error; no devuelven `{ success: false }` | Hoy hay dos estilos y cada ruta tiene que tratar ambos. Con `throw`, `errorHandler` actúa siempre | Skill `s3-operation-review` | **No cumple**: `deleteImageFromS3` y `deleteTermFromS3` devuelven el error (B5) |
| Distingue "no existe" de "falló": solo `NoSuchKey` se convierte en un valor vacío; cualquier otro error se propaga | Tragarse errores hace que el glosario se **sobrescriba entero** tras un fallo de permisos | Test con el SDK simulado | **No cumple**: `getTextJsonS3` devuelve `[]` ante cualquier error (A6) |
| Las claves salen de `config/s3Paths.js`, nunca de literales | Un único sitio si cambia el layout | `quality` no lo comprueba; revisión | Cumple |
| Las URLs prefirmadas llevan caducidad explícita y corta | Una URL filtrada deja de servir | Revisión | Cumple (3600 s, ver D9) |
| Toda operación que lista un prefijo **pagina** (`ContinuationToken`) | `ListObjectsV2` devuelve como máximo 1000 objetos y trunca en silencio | Revisión | **No cumple** (M10) |
| Las descargas independientes se hacen **en paralelo** (`Promise.all`), con un tope si son muchas | La latencia crece linealmente con cada provincia | Revisión | **No cumple**: `getMergedDataInS3Folder` es secuencial (M7) |
| Un objeto se lee y se escribe **entero** (sin parches parciales), y el código asume que no hay más de un escritor | Sin bloqueo, dos escrituras a la vez pierden una | Revisión | Riesgo aceptado con un solo administrador (M1) |

## 6. Tiempo y versionado

- **Una sola fuente de fecha para todo el versionado**, en **UTC**, **inyectable** (un parámetro `now = new Date()`) para poder probarla. Hoy `getNextVersion` usa `toISOString()` (UTC) y `formatFileName` usa la fecha local: en el cambio de día la versión vuelve a `v1` y **se sobrescribe un Excel del historial** (A1). El bucket de `sigmetum-infra` tiene el versionado de S3 activado, así que el objeto sobrescrito se podría recuperar **(verificado en `modules/storage/main.tf`; por confirmar que está activo en los dos entornos)**.
- El formato `AAAA-MM-DD_vN.xlsx` es **contrato con el frontend** (D2): no se cambia sin [avisarlo](mantenimiento.md#6-avisar-al-frontend-y-a-la-infraestructura).
- Los borradores (un Excel con celdas vacías pendiente de confirmar) **no son versiones**: deben vivir aparte hasta confirmarse (A2).
- Un valor que se guarda como **clave de S3** (la provincia del Excel) se valida antes: no puede ser `active` ni `terms`, ni `__proto__`, ni contener `/` (A4).

## 7. Rendimiento y event loop

| Regla | Por qué | Estado |
|---|---|---|
| No bloquees el event loop con trabajo pesado en una petición: `exceljs` carga el libro entero en memoria | Con un Excel grande, todas las demás peticiones esperan. Con una t3.nano (poca memoria) el proceso puede morir | `POST /upload`, `updateFileS3` y `deleteFileFromS3` convierten dentro de la petición (M9). Sin límite de tamaño en `multer` (M6) |
| Pon **límite de tamaño** a todo lo que entra en memoria | `multer.memoryStorage()` guarda el fichero entero en RAM | **No cumple** (M6) |
| Si el procesamiento crece, sácalo de la petición (cola + worker). La decisión de infraestructura está pendiente | Con el ALB de prod hay varias instancias: la cola no puede vivir en memoria del proceso | Sin decidir; SQS o Redis gestionado (**por confirmar** con infra) |
| Lo que cambia poco y se pide mucho se cachea o se precalcula | `GET /get-merged-data` recalcula todo en cada petición | M8 |

## 8. Configuración y entorno

- **Toda variable nueva** entra por `config/validateEnv.js` (`required`; o `requiredLocal` si solo hace falta con `NODE_ENV=local`), por `.env.example` (con el valor **vacío** si es un secreto) y por el entorno de Beanstalk de `sigmetum-infra`. Las opcionales (`NODE_ENV`, `PORT`, `API_PREFIX`) se declaran en `OPTIONAL_ENV` de `scripts/quality-check.mjs` con su motivo. Procedimiento: skill `env-var-change`.
- **Se valida el valor, no solo que exista.** Hoy `validateEnv` solo comprueba presencia: un `ADMIN_PASSWORD` que no sea un hash bcrypt hace que **todos los logins den 401** sin ningún aviso, y un `JWT_SECRET` corto se acepta (M15).
- Se lee `process.env` **al usarse o al arrancar, de forma centralizada**, no dispersa. Hoy se lee al cargar los módulos (`userAuthentication.js`) y dentro de las funciones (`awsS3connect.js`).
- Nada de valores por defecto que oculten una configuración ausente en producción.

## 9. Versionado de la API

- El prefijo `API_PREFIX` (`/api/v1`) es parte del contrato con el frontend (`VITE_API_PREFIX`).
- Un **cambio incompatible** (quitar o renombrar un campo, cambiar el envoltorio, el formato de versiones o las columnas del Excel) **sube el prefijo** (`/api/v2`) y conserva el anterior hasta que el frontend se actualice. No se cambia `/api/v1` en caliente.
- Un cambio **compatible** (un campo nuevo, un endpoint nuevo) no sube el prefijo, pero se documenta en [04](../04-api.md) y se comunica.
- El inventario de endpoints vive en [04](../04-api.md); `docs:check` lo compara con el código. Lo que espera el frontend está en `../sigmetum-frontend/docs/integracion/para-backend.md`.

## 10. Registros (logs)

| Regla | Por qué | Se comprueba | Estado |
|---|---|---|---|
| **Nunca** se escriben tokens, contraseñas, cabeceras `Authorization`, `req.body` ni `process.env` en un log | Quien lea los logs (CloudWatch) podría suplantar al administrador | `npm run quality` (patrón sobre `console.*`) | Cumple |
| No metas tokens ni secretos en la URL (`?token=`) | `morgan('combined')` registra la URL completa | Revisión | Cumple: el token va en la cabecera |
| Registra el **mensaje** del error, no objetos enteros del SDK, en rutas de autenticación | Un objeto de error puede arrastrar datos de la petición | Revisión | Las funciones de S3 hacen `console.error(..., error)` con el objeto: aceptable hoy, revisar si se añaden datos sensibles |
| Usa `console.error` y `console.warn`; `console.log` solo en el arranque | ESLint avisa de cualquier otro `console` (`no-console`) | `npm run lint` | 1 aviso: el mensaje de arranque de `index.js` |
| Los datos personales (nombre y correo del formulario) no se guardan ni se registran | Privacidad | Revisión | Cumple: solo se envían por correo. `morgan` sí registra la IP **(por confirmar** si hay que tratarla como dato personal**)** |

## 11. Pruebas (TDD)

**Hoy no hay tests (M11).** En esta fase no se implantan, pero cuando se empiece se hará así:

1. **Primero el test**: uno que falle **por el motivo correcto** (no por un error de sintaxis ni de importación) y se comprueba.
2. **Después el cambio mínimo** que lo hace pasar.
3. **Por último**, toda la suite, `lint`, `quality` y `docs:check`.

| Regla | Por qué |
|---|---|
| Un fallo corregido lleva un test que fallaba antes del arreglo | Es la prueba de que el arreglo sirve |
| Se prueba comportamiento (respuesta y efectos), no implementación | Sobrevive a refactors |
| S3 y el correo se simulan; la red no se toca | Los tests no dependen de AWS |
| No simules código propio si puedes usar el real | Un mock que repite la implementación no prueba nada |
| Cuando el test pasa a la primera, sospecha | Puede probar lo que ya funcionaba |

**Stack propuesto** (por confirmar, antes de instalar nada):

| Herramienta | Uso |
|---|---|
| `node:test` (integrado en Node 20) | Ejecutor y aserciones, sin dependencias. Vitest es la alternativa si se quiere compartir herramienta con el frontend |
| `supertest` | Llamar a la app sin abrir un puerto |
| `aws-sdk-client-mock` | Simular el cliente de S3 (`@aws-sdk/client-s3` v3) |

**Requisitos previos para poder probar** (hallazgos ya abiertos): separar `app` de `index.js` para exportarla sin arrancar el servidor (M13); que `functions/` no importe S3 (M14); poder inyectar la fecha (A1).

**Orden de cobertura** (donde están los fallos más caros):

1. `convertExcelToJson`: columnas por posición, celdas vacías, valores con coma, fórmulas y texto enriquecido.
2. `getNextVersion` y `formatFileName`: versiones del mismo día y cambio de día (A1).
3. Flujo `upload` → `upload/confirm` → `delete-file`: versión activa tras cada paso (A2).
4. Login: usuario incorrecto, contraseña incorrecta, **contraseña ausente** (A7).
5. Validación de entrada de cada ruta (400 en lugar de 500).
6. Tests de contrato con el frontend (fixtures de respuestas reales), como recomienda su documento.

## 12. Dependencias

| Regla | Por qué |
|---|---|
| No añadas una librería para algo que se resuelve en unas pocas líneas | Cada dependencia añade superficie de ataque y peso |
| Antes de añadir una: mantenimiento, licencia, tamaño, `npm audit`, y que funcione con **Node 20** | Beanstalk ejecuta **Node.js 20** (`64bit Amazon Linux 2023 v6.4.0 running Node.js 20`, verificado en `sigmetum-infra`) |
| `package.json` declara `"engines": { "node": ">=20" }` | Que un Node distinto avise al instalar. **No está declarado hoy (B3)** |
| `npm install` actualiza `package-lock.json`: se confirma siempre. En integración continua y en despliegues, `npm ci` | Instalaciones reproducibles |
| Las dependencias de desarrollo de las herramientas (`eslint`, plugins) van con **versión exacta** | Que el tope de avisos no cambie solo |
| Nunca `npm audit fix --force` | Puede subir versiones mayores sin avisar (hoy lo haría con `nodemailer`) |
| Toda dependencia nueva se documenta en [02](../02-tecnologias.md) con la versión **instalada** | `docs:check` lo exige |

## 13. Git y commits

- Mensajes en inglés, en imperativo, que expliquen el **porqué**.
- Un fallo o una funcionalidad por commit, con su test y su documentación. No mezcles un refactor con una corrección.
- Nunca se versionan `.env` ni secretos: `npm run quality` lo comprueba.
- No se hace push ni se fusiona sin revisión.

## 14. ESLint y el tope de avisos

`npm run lint` (ESLint 9, configuración en `eslint.config.js`) falla si hay **errores** o si los **avisos superan el tope** de `--max-warnings` en `package.json`.

- Reglas: `eslint:recommended`, `eslint-plugin-security` (recomendadas) y unas pocas de `eslint-plugin-n` (módulos que faltan o sobran, APIs obsoletas, `child_process`). Son **errores**: `no-eval`, `no-implied-eval`, `no-new-func`, `n/no-restricted-require` (`child_process`), `n/no-missing-require`, `n/no-extraneous-require` y `n/no-deprecated-api`.
- Los avisos (variables sin usar, `console.log`, `eqeqeq` y las de `security/*`) son deuda visible: no bloquean, pero **no pueden crecer**.
- **Cuando corrijas avisos, baja el tope** al nuevo número. `npm run quality` falla si el tope es mayor que los avisos reales.
- No uses `// eslint-disable` sin un comentario que explique el motivo.
- Una regla relajada o desactivada se justifica **en `eslint.config.js`** y se anota aquí. Hoy hay dos excepciones: `security/detect-object-injection` desactivada en `config/validateEnv.js` y `functions/convertExcelToJson.js` (el índice sale de listas fijas del código), y las reglas de `security/*` desactivadas en `scripts/*.mjs` (herramientas de desarrollo que no atienden peticiones).
- Avisos reales hoy (los que cuenta el tope): una variable sin usar en `aws/awsS3connect.js` (el `catch` de `getTextJsonS3`, relacionado con A6), el `console.log` de arranque y tres de `security/detect-object-injection` en `routes/data.js` (`grouped[provincia]`, relacionado con A4: una provincia llamada `__proto__` daría un 500).

## 15. Anti-patrones que ya están en el código

No los repitas al escribir código nuevo:

| Patrón | Dónde | Hallazgo |
|---|---|---|
| Manejador `async` sin `try/catch` | `functions/userAuthentication.js` | A7 |
| Leer `req.file.buffer` o `term.trim()` sin validar | `routes/data.js`, `routes/content.js` | A3 |
| Dos fuentes de fecha para el versionado | `getNextVersion.js` y `formatFileName.js` | A1 |
| Tragarse todos los errores y devolver un valor por defecto | `getTextJsonS3` | A6 |
| Valor del Excel usado como clave de S3 y como clave de un objeto sin validar | `routes/data.js` (`grouped[provincia]`), `POST /upload` | A4 |
| Lógica de negocio en la capa de S3 | `deleteFileFromS3`, `updateFileS3` | M14 |
| Una función "pura" que llama a S3 | `getNextVersion` | M14 |
| Devolver `err.message` al cliente | `middleware/errorHandler.js` | M17 |
| Funciones de S3 que a veces lanzan y a veces devuelven `{ success: false }` | `deleteImageFromS3`, `deleteTermFromS3` | B5 |
| Descargas secuenciales en un bucle | `getMergedDataInS3Folder` | M7 |
| Leer, modificar y escribir un objeto entero sin control de concurrencia | `uploadTextToJsonS3`, `deleteTermFromS3` | M1 |
| `listObjectsV2` sin paginar | `listFilesInS3Folder` | M10 |
| Middleware fuera de `middleware/` | `functions/tokenAuthentication.js` | B7 |
| Arrancar el servidor al importar el módulo | `index.js` | M13 |
| `max` (obsoleto) en `express-rate-limit` 8 | `routes/auth.js` | B6 |

## 16. Mantener esta guía

Se actualiza cuando aparece un patrón nuevo que conviene prohibir o fomentar, sobre todo si sale de un fallo: anota la regla, el motivo, cómo se comprueba y, si se puede, añade la comprobación automática a ESLint o a `scripts/quality-check.mjs`. Cuando se corrige un hallazgo, se actualiza su fila de "Estado". Las cifras viven solo en [07](../07-estado-y-deuda-tecnica.md#métricas).
