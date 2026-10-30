# Buenas prácticas del backend

Normas de trabajo para escribir código en este repositorio. No son teoría general: cada regla sale del código actual o de un fallo que ya hemos encontrado, e indica **por qué**, **cómo se comprueba** y **en qué estado está hoy**.

- Seguridad: [seguridad.md](seguridad.md). Qué documentar después de cada cambio: [mantenimiento.md](mantenimiento.md).
- Los hallazgos con id (A, M, B, D, I) están en [07](../07-estado-y-deuda-tecnica.md).
- Las normas y su motivo viven aquí; el procedimiento paso a paso, en las skills del proyecto ([plugins/README.md](../../plugins/README.md)), que remiten a esta guía.
- Si una regla choca con lo que te piden, **avisa y pregunta** antes de saltártela.
- Marcas de certeza: **(verificado)** lo comprobado contra el código o ejecutándolo; **(por confirmar)** lo deducido.

## 1. Definición de terminado

Un cambio está terminado cuando pasan estos comandos y la documentación está al día:

| Comando | Comprueba |
|---|---|
| `npm run lint` | ESLint 9: sin errores y sin superar el tope de avisos |
| `npm run quality` | Patrones prohibidos, rutas mutantes sin autenticación, variables sin declarar, secretos, `npm audit` de producción y ESLint |
| `npm run docs:check` | Que la documentación sigue al código |
| `npm test` | Suite de la API (`tests/`, `node:test` + `supertest`; cobertura parcial, M11) |

## 2. Estructura: qué va en cada sitio

| Carpeta | Va aquí | No va aquí | Estado |
|---|---|---|---|
| `routes/` | La capa HTTP: leer y **validar** la entrada, llamar a la lógica, dar forma a la respuesta, `next(error)` | Lógica de negocio, acceso directo a S3 | **No cumple del todo**: las rutas llaman a `aws/` y a `functions/`, pero `routes/data.js` conserva la orquestación de la versión activa en dos funciones privadas (`activateFrom` y `removeVersion`) y `POST /upload` concentra bastante (conversión, listado, versión, dos subidas). Decisión del usuario (M14, 29/10/2026): no hay capa de servicio |
| `functions/` | Lógica **pura y probable**: recibe datos y devuelve datos (`convertExcelToJson`, `formatFileName`, `getNextVersion`, `activeVersion`) | Llamadas a S3, lectura de `process.env` al cargar el módulo, `Date` sin poder inyectarla | **Cumple en las funciones de datos** (M14 resuelto el 29/10/2026): `getNextVersion` y `activeVersion` no importan `aws/` (lo comprueba `tests/capas-importaciones.test.js`) y la fecha se inyecta (`now = new Date()` como valor por defecto; A1 resuelto). **Excepciones (B7)**: `tokenAuthentication.js` es un middleware y `userAuthentication.js` un manejador de ruta que lee `process.env` al cargar el módulo |
| `aws/` | **La única capa que habla con S3**: leer, escribir, listar, borrar, firmar URLs | Decisiones de negocio (qué versión activar, cuándo reconvertir un Excel) | **Cumple** (M14 resuelto el 29/10/2026): solo hace I/O (`deleteFileFromS3` borra una clave, `putJsonToS3` escribe un JSON); no importa `functions/` ni decide la versión activa |
| `config/` | Constantes de rutas de S3 (`s3Paths.js`) y validación del entorno (`validateEnv.js`) | Lógica | Cumple |
| `middleware/` | Middlewares transversales (hoy, `errorHandler`) | Manejadores de una ruta concreta | `tokenAuth` vive en `functions/` (B7) |
| `app.js` | La app Express: middlewares, montaje de rutas, `notFound` y `errorHandler`; se exporta sin abrir puerto | Lógica de negocio, `dotenv`, `validateEnv`, `listen` | Cumple (M13, 28/10/2026) |
| `index.js` | Arranque: `dotenv`, validación del entorno, `require('./app')` y `listen` | Lógica, middlewares y rutas | Cumple |

Reglas de dependencia: `routes → functions / aws / config`, `aws → config`, `functions → (nada de infraestructura)`. Una capa inferior **no importa** de una superior.

Nombres: archivos en `camelCase` (`awsS3connect.js` es la excepción con minúscula en `connect`); código y commits en inglés; mensajes de error al cliente en inglés (es lo que ya hace la API).

## 3. Contrato de respuesta y errores

| Regla | Por qué | Se comprueba | Estado |
|---|---|---|---|
| Toda ruta responde `{ success: true, data }` o `{ success: false, error }` | El frontend solo considera éxito `response.ok` **y** `success === true` (contrato en `../sigmetum-frontend/docs/integracion/para-backend.md`) | Revisión; `docs:check` comprueba la documentación | Cumple |
| Los fallos inesperados se pasan con `next(error)` a `middleware/errorHandler.js`; las validaciones de entrada responden 400 directamente | Un único sitio da forma a los errores y decide qué se loguea | Skill `new-endpoint` | Cumple en las rutas de S3 y de contenido |
| **Todo manejador `async` captura sus errores** (`try/catch` + `next`) | Express 4 **no** captura las promesas rechazadas: la petición se queda colgada y el error acaba en `unhandledRejection` | Revisión | Cumple en el código tocado el 28/10/2026 (A7 resuelto: `userAuth` ya captura y llama a `next(error)`). Queda por revisar el resto de manejadores |
| Códigos HTTP correctos: **400** entrada inválida, **401** sin token o token inválido, **404** recurso inexistente, **429** límite de peticiones, **500** solo fallos propios | El frontend y quien use la API distinguen el caso por el código | Tests de cada ruta (`npm test`) | **Cumple en las rutas de A3 resueltas el 28/10/2026** (entrada ausente o de tipo incorrecto responde 400; `MulterError` también); `NoSuchKey` de S3 da 404 desde el 29/10/2026 (B9): el mapeo es global en `errorHandler` (por `name` o `Code`), así que también lo da en carrera (`get-merged-data`, `delete-file`, `upload/confirm` al cancelar); `NoSuchBucket`, `AccessDenied` y red siguen en 500 |
| El mensaje de error al cliente es **controlado**, no `err.message` tal cual | Un error interno puede revelar rutas, claves o nombres de librerías | Revisión de `errorHandler.js` | Cumple (M17, 28/10/2026): `friendlyMessage(err, status)` devuelve un texto mapeado (`publicMessage`, `Token expired`, `Invalid JSON`, `Payload too large`, `Bad request`, almacenamiento) o `Internal server error`; el `err.message` real solo va a la consola. Lo comprueba `tests/errores-controlados.test.js` |
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
| `POST /log` | `username`, `password` | Que ambos sean cadenas (400); después usuario y contraseña (401) | Nada pendiente de tipo (A7 resuelto) |
| `POST /upload` | `file` (multipart) | Que exista (400); extensión `.xlsx` (400); `MulterError` a 400; la provincia de la primera fila con `validateProvincia` (400 `Province is required`, `Province is not valid`, `Province is reserved` o `Excel contains more than one province`, antes de cualquier escritura; A4 resuelto el 28/10/2026) | Tamaño máximo (M6). En esta ruta el MIME no se comprueba porque lo manda el cliente y no es fiable |
| `POST /upload/confirm` | `draftKey`, `confirmed` | `draftKey` cadena no vacía (400) y `isValidDataKey` (400 `Invalid draftKey`, sin normalizar la clave, antes de tocar S3) | Que `confirmed` sea booleano |
| `POST /update-file`, `POST /delete-file` | `fileName` | Cadena no vacía (400) y `isValidDataKey` (400 `Invalid fileName`, antes de tocar S3) | Que el objeto exista (no se exige) |
| `GET /get-data/:path(*)` | `path` | Nada | Restringir a `data/active/` (M2) |
| `GET /get-image` | `imageKey` | Cadena no vacía (400; cubre `?imageKey=a&imageKey=b`) y lista de permitidos `isValidImageKey` (400 `imageKey is not valid`, antes de llamar a S3) | Que la clave exista en el listado (no se exige: riesgo residual aceptado) |
| `POST /upload-image` | `file`, `title` | `file` presente y `title` cadena no vacía (400); `validateImageUpload`: extensión y MIME exactos, título saneado y firma del contenido (400 con texto fijo, M5, 29/10/2026); `MulterError` a 400 | Reprocesado de la imagen (un polyglot con cabecera válida pasa); sin NFC en el título; la sobrescritura de una clave repetida es silenciosa. El tamaño (5 MB) se limita desde M6 |
| `DELETE /delete-image` | `imageKey` | Cadena no vacía (400) y `isValidImageKey` (400 `imageKey is not valid`, antes de llamar a S3) | Nada de forma pendiente; el resto de M4 está en las rutas de versiones |
| `POST /upload-term`, `DELETE /delete-term` | `term` | Cadena (400 `Term must be a string` en `/upload-term`) y no vacía (400) | Longitud máxima |
| `POST /send-email` | `username`, `email`, `subject`, `message` | `validateContactMessage`: cuatro cadenas no vacías tras `trim()`, longitudes (100, 150, 2000, 254), comprobación básica del formato del correo (no RFC), sin caracteres de control en nombre, correo y asunto y sin controles (salvo salto de línea y tabulador) en el mensaje (400, no se envía correo); límite de 5 por 15 minutos por IP (429) | Nada pendiente (M3 resuelto) |

Cómo validar: **una función de validación por forma de entrada**, con una lista de permitidos (no de prohibidos), sin dependencias nuevas salvo que compense (ver sección 12). Las expresiones regulares de claves de S3 y de nombres de fichero se definen **una vez** en `config/` y las usan la ruta y los tests.

**Choque con la iteración A7/A3 (28/10/2026)**: la regla de arriba pide una función de validación por forma de entrada, pero el plan aprobado de esa iteración usa comprobaciones en línea (`typeof x !== 'string'`) en cada manejador y no crea `functions/validateInput.js`, para no añadir un módulo sin ahorrar código. Por eso la tabla de arriba describe lo que valida cada ruta tal como está, no una función compartida. La regla sigue vigente y se decide con el usuario si se extrae un validador (por ejemplo, junto con M4 y M5), cuando haya más de unas pocas comprobaciones repetidas. Desde la entrega 1 de M21 (28/10/2026) `POST /send-email` (`functions/validateContactMessage.js`) el `imageKey` (`functions/validateImageKey.js`, constantes en `config/s3Paths.js`) y, desde A1/A4 (28/10/2026), la provincia del Excel (`functions/validateProvincia.js`) y las claves de versión (`functions/validateDataKey.js`) sí siguen la regla: una función pura por forma de entrada.

## 5. S3: una sola convención

| Regla | Por qué | Se comprueba | Estado |
|---|---|---|---|
| Las funciones de `aws/` **lanzan** ante un error; no devuelven `{ success: false }` | Hoy hay dos estilos y cada ruta tiene que tratar ambos. Con `throw`, `errorHandler` actúa siempre | Skill `s3-operation-review` | Cumple (B5, 29/10/2026): `deleteImageFromS3` y `deleteTermFromS3` lanzan el error original y las rutas `delete-*` lo pasan con `next(error)`; lo comprueban `tests/s3-robustez.test.js` y `tests/errores-controlados.test.js` |
| Distingue "no existe" de "falló": solo `NoSuchKey` se convierte en un valor vacío; cualquier otro error se propaga | Tragarse errores hace que el glosario se **sobrescriba entero** tras un fallo de permisos | Test con el SDK simulado | Cumple (A6, `c95a6fe`, 29/10/2026): `getTextJsonS3` solo devuelve `[]` con `NoSuchKey` (por `name` o `Code`) y propaga cualquier otro error, un cuerpo vacío o un JSON que no es un array |
| Las claves salen de `config/s3Paths.js`, nunca de literales | Un único sitio si cambia el layout | `quality` no lo comprueba; revisión | Cumple |
| Las URLs prefirmadas llevan caducidad explícita y corta | Una URL filtrada deja de servir | Revisión | Cumple (3600 s, ver D9) |
| Toda operación que lista un prefijo **pagina** (`ContinuationToken`) | `ListObjectsV2` devuelve como máximo 1000 objetos y trunca en silencio | Revisión | **No cumple** (M10) |
| Las descargas independientes se hacen **en paralelo** (`Promise.all`), con un tope si son muchas | La latencia crece linealmente con cada provincia | Revisión | **No cumple**: `getMergedDataInS3Folder` es secuencial (M7) |
| Un objeto se lee y se escribe **entero** (sin parches parciales), y el código asume que no hay más de un escritor | Sin bloqueo, dos escrituras a la vez pierden una | Revisión | Riesgo aceptado con un solo administrador (M1) |

## 6. Tiempo y versionado

- **Una sola fuente de fecha para todo el versionado**, en **UTC**, **inyectable** (un parámetro `now = new Date()`) para poder probarla. Desde A1 (28/10/2026) `getNextVersion` y `formatFileName` toman el día UTC del mismo `now`; antes `formatFileName` usaba la fecha local y en el cambio de día la versión volvía a `v1` y **se sobrescribía un Excel del historial**. El bucket de `sigmetum-infra` tiene el versionado de S3 activado, así que el objeto sobrescrito se podría recuperar **(verificado en `modules/storage/main.tf`; por confirmar que está activo en los dos entornos)**.
- El formato `AAAA-MM-DD_vN.xlsx` es **contrato con el frontend** (D2): no se cambia sin [avisarlo](mantenimiento.md#6-avisar-al-frontend-y-a-la-infraestructura).
- Los borradores (un Excel con celdas vacías pendiente de confirmar) **no son versiones**: deben vivir aparte hasta confirmarse (A2).
- Un valor que se guarda como **clave de S3** (la provincia del Excel) se valida antes: no puede ser `active` ni `terms`, ni `__proto__`, ni contener `/` (A4).

## 7. Rendimiento y event loop

| Regla | Por qué | Estado |
|---|---|---|
| No bloquees el event loop con trabajo pesado en una petición: `exceljs` carga el libro entero en memoria | Con un Excel grande, todas las demás peticiones esperan. Con una t3.nano (poca memoria) el proceso puede morir | `POST /upload`, `updateFileS3` y `deleteFileFromS3` convierten dentro de la petición (M9). Sin límite de tamaño en `multer` (M6) |
| Pon **límite de tamaño** a todo lo que entra en memoria | `multer.memoryStorage()` guarda el fichero entero en RAM | Cumple (M6 resuelto el 28/10/2026) |
| Si el procesamiento crece, sácalo de la petición (cola + worker). La decisión de infraestructura está pendiente | Con el ALB de prod hay varias instancias: la cola no puede vivir en memoria del proceso | Sin decidir; SQS o Redis gestionado (**por confirmar** con infra) |
| Lo que cambia poco y se pide mucho se cachea o se precalcula | `GET /get-merged-data` recalcula todo en cada petición | M8 |

## 8. Configuración y entorno

- **Toda variable nueva** entra por `config/validateEnv.js` (`required`; o `requiredLocal` si solo hace falta con `NODE_ENV=local`), por `.env.example` (con el valor **vacío** si es un secreto) y por el entorno de Beanstalk de `sigmetum-infra`. Las opcionales (`NODE_ENV`, `PORT`, `API_PREFIX`) se declaran en `OPTIONAL_ENV` de `scripts/quality-check.mjs` con su motivo. Procedimiento: skill `env-var-change`.
- **Se valida el valor, no solo que exista.** `validateEnv` comprueba, además de la presencia, que `ADMIN_PASSWORD` sea un hash bcrypt completo, que `JWT_SECRET` tenga al menos 32 caracteres y que `JWT_EXPIRATION` sea una duración con unidad y positiva (M15 resuelto el 28/10/2026). Es estricto (el arranque falla) salvo con `NODE_ENV` exactamente `local` o `test`, donde solo avisa. Los mensajes nunca llevan el valor.
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

**Hay una base de tests (`tests/`, `npm test`) y es parcial (M11).** Cómo se escriben y qué cubren: [mantenimiento.md](mantenimiento.md#tests-de-la-api-m11-parcial). Se trabaja así:

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

**Stack** (`node:test` y `supertest` están instalados; `aws-sdk-client-mock` no se usa: S3 se simula inyectando espías en `require.cache`, decisión 2 del plan de M13/M11):

| Herramienta | Uso |
|---|---|
| `node:test` (integrado en Node 20) | Ejecutor y aserciones, sin dependencias. Vitest es la alternativa si se quiere compartir herramienta con el frontend |
| `supertest` (7.3.1, versión exacta) | Llamar a la app sin abrir un puerto |

**Requisitos previos para poder probar**: la app se exporta sin arrancar el servidor (`app.js`, M13 resuelto) y la fecha se inyecta (A1 resuelto); `functions/` ya no importa S3 (M14 resuelto) y el flujo de datos se prueba con un S3 simulado con estado (`tests/helpers/s3-con-estado.js`).

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
- Una regla relajada o desactivada se justifica **en `eslint.config.js`** y se anota aquí. Hoy hay dos excepciones: `security/detect-object-injection` desactivada en `config/validateEnv.js` y `functions/convertExcelToJson.js` (el índice sale de listas fijas del código), y tres reglas de `security/*` (rutas de fichero, expresiones regulares no literales e inyección de objetos) desactivadas en `scripts/**/*.mjs` y `plugins/**/*.mjs` (herramientas de desarrollo que no atienden peticiones; el plugin `ciclo-agentico` comparte el bloque de los scripts de mantenimiento, y sus pruebas usan `node:test`, sin dependencias nuevas).
- Avisos reales hoy (los que cuenta el tope, 4): el `console.log` de arranque y tres de `security/detect-object-injection` en `routes/data.js` (`grouped[provincia]`, relacionado con A4: una provincia llamada `__proto__` daría un 500).

## 15. Anti-patrones que ya están en el código

No los repitas al escribir código nuevo:

| Patrón | Dónde | Hallazgo |
|---|---|---|
| Manejador `async` sin `try/catch` | (`functions/userAuthentication.js` lo tenía; corregido el 28/10/2026) | A7 resuelto |
| Leer `req.file.buffer` o `term.trim()` sin validar | (corregido el 28/10/2026 en las rutas listadas de A3; quedan las entradas no revisadas) | A3 |
| Dos fuentes de fecha para el versionado | `getNextVersion.js` y `formatFileName.js` | A1 (resuelto el 28/10/2026) |
| Tragarse todos los errores y devolver un valor por defecto | `getTextJsonS3` | A6 |
| Valor del Excel usado como clave de S3 y como clave de un objeto sin validar | `routes/data.js` (`grouped[provincia]`), `POST /upload` | A4 |
| Lógica de negocio en la capa de S3 | `deleteFileFromS3`, `updateFileS3` | M14 (resuelto el 29/10/2026) |
| Una función "pura" que llama a S3 | `getNextVersion` | M14 (resuelto el 29/10/2026) |
| Devolver `err.message` al cliente (o el `error` del SDK en una respuesta manual, como hacían `delete-image` y `delete-term`) | `middleware/errorHandler.js` | M17 (resuelto el 28/10/2026) |
| Funciones de S3 que a veces lanzan y a veces devuelven `{ success: false }` | `deleteImageFromS3`, `deleteTermFromS3` | B5 (resuelto el 29/10/2026) |
| Descargas secuenciales en un bucle | `getMergedDataInS3Folder` | M7 |
| Leer, modificar y escribir un objeto entero sin control de concurrencia | `uploadTextToJsonS3`, `deleteTermFromS3` | M1 |
| `listObjectsV2` sin paginar | `listFilesInS3Folder` | M10 |
| Middleware fuera de `middleware/` | `functions/tokenAuthentication.js` | B7 |

## 16. Mantener esta guía

Se actualiza cuando aparece un patrón nuevo que conviene prohibir o fomentar, sobre todo si sale de un fallo: anota la regla, el motivo, cómo se comprueba y, si se puede, añade la comprobación automática a ESLint o a `scripts/quality-check.mjs`. Cuando se corrige un hallazgo, se actualiza su fila de "Estado". Las cifras viven solo en [07](../07-estado-y-deuda-tecnica.md#métricas).
