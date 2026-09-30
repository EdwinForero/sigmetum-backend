# Estado actual y deuda técnica

- Fecha del análisis: 30/09/2026.
- Rama: `feature/sigmetum_v2`, sobre el commit `ace5367`.
- Lo marcado **(verificado)** se comprobó leyendo el código, ejecutándolo o en `sigmetum-infra`; lo marcado **(por confirmar)** se deduce, pero no se probó contra un S3 real ni contra el despliegue.
- Las normas que salen de estos hallazgos están en [buenas prácticas](guias/buenas-practicas-backend.md) y [seguridad](guias/seguridad.md).

## Resumen

El código está limpio, es pequeño y sigue convenciones consistentes: formato de respuesta único, errores centralizados, validación de entorno al arrancar, rutas de S3 centralizadas y credenciales AWS por rol/SSO. Los dos refactors recientes (seguridad y layout de S3) dejaron una base razonable.

Lo que más pesa: **no hay tests** (M11), **vulnerabilidades altas y críticas en dependencias de producción** sin resolver (M16; la puerta `npm run quality` falla por ellas), un **login que se cuelga** sin contraseña (A7), **varios fallos latentes en el flujo de versionado** (A1, A2, A4) y **dos endpoints públicos más abiertos de lo necesario** (M2, M3). Además hay 9 discrepancias abiertas con el frontend (ver [más abajo](#discrepancias-con-el-frontend)).

## Métricas

Esta es la **única** tabla con cifras del repositorio; el resto de documentos enlaza aquí. `npm run docs:check` comprueba que coincide con el código y `npm run docs:check -- --metrics` imprime los valores reales.

| Métrica | Valor |
|---|---|
| Archivos de código (sin tests) | 13 |
| Endpoints (sin /healthcheck) | 17 |
| Endpoints públicos | 8 |
| Endpoints protegidos | 9 |
| Funciones exportadas de S3 | 14 |
| Variables de entorno obligatorias | 9 |
| Dependencias de producción | 14 |
| Dependencias de desarrollo | 6 |
| Archivos de test | 0 |
| Guías (docs/guias) | 3 |

## Convención de hallazgos

Cada hallazgo tiene un id estable. Los ids **no se reutilizan**.

| Prefijo | Significado |
|---|---|
| **A** | Fallo funcional: pérdida de datos o comportamiento incorrecto |
| **M** | Mantenibilidad, seguridad, rendimiento o robustez |
| **B** | Calidad y detalles (prioridad baja) |
| **D** | Discrepancia frente al **frontend** (detalle en `../sigmetum-frontend/docs/integracion/para-backend.md`; los ids son los del frontend) |
| **I** | Desajuste frente a la **infraestructura** (`sigmetum-infra`) |

Ciclo de vida:

1. **Se anota** con id, descripción, ubicación y qué hay que hacer.
2. **Se resuelve** en un commit. Cuando exista la base de tests, el commit incluye un test que fallaba antes.
3. **Pasa a "Resueltos"** con el hash del commit. No se borra: el historial explica por qué el código es como es.
4. Si se descarta, se queda con una nota ("No procede: motivo").

## Fallos funcionales (A)

### A1. `getNextVersion` y `formatFileName` usan zonas horarias distintas
`getNextVersion.js` calcula "hoy" con `toISOString()` (UTC); `formatFileName.js` usa la fecha local. En España (UTC+1/+2), entre las 00:00 y la 01:00–02:00 hora local el nombre lleva la fecha nueva pero la versión se calcula con la del día anterior. Resultado: la versión vuelve a `v1` aunque ya exista un `v1` de hoy, y **se sobrescribe un Excel del historial**. En Beanstalk el servidor suele estar en UTC, así que el fallo aparece sobre todo en local, pero depende de la configuración del host **(por confirmar)**. El bucket de `sigmetum-infra` tiene el versionado de S3 activado **(verificado en `modules/storage/main.tf`)**, así que el objeto sobrescrito se podría recuperar; por confirmar que está aplicado en los dos entornos.
**Arreglo**: usar la misma fuente de fecha en ambos (idealmente UTC en los dos e inyectable para probarla). Como el frontend parsea el nombre (D2), cualquier cambio de formato se avisa antes.

### A2. Los borradores no confirmados cuentan como versiones reales
Una subida con celdas vacías deja el Excel en `data/{provincia}/` antes de confirmar. Si nadie confirma ni cancela (se cierra la pestaña), ese borrador:
- aparece en `/list-files` como una versión más, y
- si después se borra otra versión, `deleteFileFromS3` puede **activar el borrador** por ser el más reciente.

**Arreglo**: guardar los borradores en un prefijo propio (`data/drafts/`) y moverlos al confirmar, o marcarlos con un tag de S3.

### A3. Entradas sin validar responden 500 en lugar de 400
`POST /upload` lee `req.file.buffer` sin comprobar `req.file`: sin fichero hay un `TypeError` y responde 500. Tampoco se valida que sea un `.xlsx` (ver D3). Lo mismo ocurre con `fileName` ausente en `/update-file` y `/delete-file` (`filePath.split` lanza), con un `term` que no sea una cadena en `/upload-term` (`term.trim()` lanza) y con `GET /get-image` sin `imageKey`, que firma la clave `gallery/undefined` y devuelve 200 con una URL que dará 404. `POST /send-email` sin campos envía un correo con "undefined". **(verificado leyendo el código)**. Tabla de lo que valida cada ruta: [buenas prácticas](guias/buenas-practicas-backend.md#4-validación-de-entrada).

### A4. La provincia del Excel se usa sin sanear como carpeta de S3
Se toma de la primera fila y va directa a la clave. Un valor `active` o `terms` escribiría Excels dentro de `data/active/` y rompería `/get-merged-data` (intentaría hacer `JSON.parse` de un xlsx). Un valor `__proto__` rompe `GET /list-files` con un `TypeError` (`grouped[provincia].push is not a function`) **(verificado ejecutando la misma lógica)**; es lo que señalan los tres avisos de `security/detect-object-injection` en `routes/data.js`. Mayúsculas o acentos distintos (`Málaga` y `Malaga`) crean provincias duplicadas. Además, un Excel con varias provincias se guarda entero bajo la primera.

### A5. `/list-images` falla con la galería vacía
`getPresignedUrlsFromS3Folder` lanza `No files found in the specified folder.` y el handler responde 500 en lugar de `[]`. Es la parte del backend de D5.

### A6. `getTextJsonS3` oculta errores
Devuelve `[]` ante cualquier fallo, no solo "no existe". Con un problema de permisos o de red, `/list-terms` responde 200 vacío y, peor, `uploadTextToJsonS3` parte de `[]` y **sobrescribe el glosario entero** con un único término. `deleteTermFromS3` hace lo mismo con el filtrado.

### A7. El login se cuelga cuando falta la contraseña
`userAuth` es un manejador `async` sin `try/catch`. Con el usuario correcto y sin `password` (o con uno que no sea una cadena), `bcrypt.compare` rechaza con `data and hash arguments required`; Express 4 no captura esa promesa rechazada, la petición **no recibe respuesta** y el error acaba en el `unhandledRejection` de `index.js` **(verificado ejecutando el manejador con un servidor de prueba: sin respuesta tras 3 segundos)**. Solo lo provoca quien conoce el nombre de usuario, y cada petición deja una conexión abierta hasta el tiempo de espera.
**Arreglo**: `try/catch` con `next(error)` y validar que `username` y `password` son cadenas (responde 400). Relacionado con M12 (limitador del login).

## Seguridad, rendimiento y robustez (M)

| Id | Hallazgo | Riesgo | Qué hacer |
|---|---|---|---|
| **M1** | Condiciones de carrera en read-modify-write: alta y baja de términos, cálculo de la versión siguiente y regeneración del activo leen y luego escriben sin bloqueo | Con dos administradores a la vez, o con dos instancias en prod, se pierden escrituras. Con un único admin el riesgo es bajo | Aceptarlo de forma explícita mientras haya un admin, o usar escritura condicional de S3 (`If-Match`) |
| **M2** | `GET /get-data/:path(*)` es público y lee **cualquier clave** del bucket | Cualquiera puede leer cualquier JSON del bucket si conoce o adivina la clave | Restringir a `data/active/`. **No cerrarlo antes de resolver D1**: el frontend lo usa hoy para abrir versiones |
| **M3** | `POST /send-email` es público, sin límite de peticiones ni validación (`subject`, `username` y `email` entran en el asunto y en `replyTo` sin comprobar) | Puede inundar el buzón y agotar la cuota de Gmail; y con el aviso de `nodemailer` (M16) la entrada sin validar pesa más | Añadir `rateLimit` y validar que los campos existen, son cadenas, el formato de `email` y las longitudes |
| **M4** | `/update-file` y `/delete-file` no validan `fileName` | Un token válido podría borrar cualquier objeto del bucket (un activo, el glosario) | Validar que la clave encaje con `data/{provincia}/AAAA-MM-DD_vN.xlsx` |
| **M5** | `/upload-image` no valida el tipo MIME y el saneo del título es parcial (solo espacios) | Se pueden subir ficheros que no son imágenes a la galería | Lista blanca de MIME y extensiones, sanear caracteres |
| **M6** | `multer` sin `limits.fileSize` | Ficheros enormes se cargan enteros en la memoria de una t3.nano | Poner un límite (por ejemplo, 10 MB) |
| **M7** | `getMergedDataInS3Folder` descarga los activos en **secuencia** | La latencia crece con el número de provincias | `Promise.all` |
| **M8** | `/get-merged-data` recalcula todo en cada petición y es el endpoint más llamado | Latencia y coste de S3 innecesarios | Generar un `merged.json` al activar versiones o cachear |
| **M9** | `deleteFileFromS3` y `updateFileS3` descargan y reconvierten un Excel dentro de la petición | Con ficheros grandes la petición se alarga | Candidatos a procesamiento asíncrono si los ficheros crecen |
| **M10** | `listFilesInS3Folder` no pagina | Más de 1000 objetos bajo un prefijo se truncan en silencio | Paginar con `ContinuationToken` |
| **M11** | **No hay tests** ni framework de testing | Es el mayor riesgo para seguir evolucionando | Empezar por `convertExcelToJson`, `getNextVersion` y el flujo upload/confirm/delete con S3 simulado |
| **M12** | El limitador de login no tiene `trust proxy`. `index.js` no llama a `app.set('trust proxy', ...)` **(verificado)**, y `express-rate-limit` avisa de ello cuando llega `X-Forwarded-For` | Detrás del ALB de prod, `req.ip` sería la IP del balanceador y **todos los clientes compartirían el mismo contador** de 10 intentos cada 15 minutos: cualquiera puede bloquear el login del admin, y el límite no distingue atacantes **(por confirmar en el despliegue real)** | Configurar `trust proxy` con el número de saltos real (ALB y, si lo hay, el proxy de la plataforma de Beanstalk) y comprobarlo con infra. Relacionado con D7 |
| **M13** | `index.js` arranca el servidor (`app.listen`) al importarse y no exporta la app | No se puede probar la API con `supertest` sin abrir un puerto ni cargar el entorno | Separar `app.js` (construye y exporta la app) de `index.js` (valida el entorno y escucha). Requisito para M11 |
| **M14** | Capas mezcladas: `aws/` contiene lógica de negocio (`deleteFileFromS3` y `updateFileS3` deciden qué versión queda activa y reconvierten el Excel con `convertExcelToJson`), y `functions/getNextVersion.js` depende de S3 | La lógica de versionado no se puede probar sin simular S3, y la capa de S3 no es intercambiable | Dejar en `aws/` solo leer, escribir, listar, borrar y firmar; mover la regla de la versión activa a `functions/` (funciones puras que reciben datos) o a una capa de servicio. Ver [estructura](guias/buenas-practicas-backend.md#2-estructura-qué-va-en-cada-sitio) |
| **M15** | `validateEnv.js` solo comprueba que las variables existan, no su valor | Un `ADMIN_PASSWORD` que no sea un hash bcrypt hace que **todos los logins den 401** sin aviso; un `JWT_SECRET` corto se acepta | Validar que `ADMIN_PASSWORD` tiene forma de hash bcrypt (`$2a$`, `$2b$` o `$2y$`), que `JWT_SECRET` tiene una longitud mínima y que `JWT_EXPIRATION` es un valor válido de `jsonwebtoken` |
| **M16** | **Vulnerabilidades altas y críticas en dependencias de producción** sin resolver (`npm audit --omit=dev`), que `npm run quality` rechaza: `express` y `path-to-regexp` (ReDoS), `jws` (vía `jsonwebtoken`, verificación de firmas HMAC), `nodemailer` (inyección de comandos SMTP y envío a un dominio no previsto), `fast-xml-parser` (vía el SDK de AWS) e `ip-address` (vía `express-rate-limit`) **(verificado el 30/09/2026)** | Son alcanzables en producción: autenticación, correo y enrutado | `npm audit fix` (sin `--force`) resuelve `express`, `path-to-regexp`, `jws`, `fast-xml-parser` e `ip-address` sin cambios mayores; `nodemailer` exige un cambio de versión mayor y hay que revisar el uso de `sendMail`. Hay además vulnerabilidades moderadas y bajas. Aceptadas con motivo escrito: `tar`, `@mapbox/node-pre-gyp` y `brace-expansion` (ver [seguridad](guias/seguridad.md#s9-dependencias)) |
| **M17** | `errorHandler` devuelve `err.message` al cliente para cualquier error no mapeado, también en producción | Un error interno (un `JSON.parse` fallido, un mensaje del SDK o de `bcrypt`) revela detalles de la implementación | Para errores 5xx devolver un mensaje genérico (`Internal server error`) y registrar el detalle; conservar los mensajes de `friendlyMessage` para los casos mapeados y los 4xx |

## Calidad y detalles (B e I)

| Id | Hallazgo | Qué hacer |
|---|---|---|
| **B1** | Sin cabeceras de seguridad (`helmet`) | Opcional: es una API JSON |
| **B2** | `nodemon` está instalado pero no hay script `dev` | Añadir `"dev": "nodemon index.js"` |
| **B3** | `package.json` no declara `engines`. Beanstalk ejecuta `Node.js 20` **(verificado en `sigmetum-infra`, `64bit Amazon Linux 2023 v6.4.0 running Node.js 20`)** | Añadir `"engines": { "node": ">=20" }` |
| **B4** | Usuario admin único en variables de entorno | Correcto hoy; es un límite si alguna vez hay más de un editor |
| **B5** | Estilos de error mezclados: unas funciones de S3 lanzan y otras devuelven `{ success: false }` (`deleteImageFromS3`, `deleteTermFromS3`); las rutas tienen que tratar ambos casos | Unificar en lanzar y dejar que actúe `errorHandler` |
| **B6** | `loginLimiter` usa la opción `max`, que en `express-rate-limit` 8 está obsoleta (se sigue aceptando) | Cambiar a `limit` |
| **B7** | Archivos fuera de su sitio: `functions/tokenAuthentication.js` es un middleware y `functions/userAuthentication.js` un manejador de ruta, y `middleware/` solo tiene `errorHandler`. La carpeta `uploads/` está vacía y sin uso (`multer` trabaja en memoria) | Mover el middleware a `middleware/` (y el manejador de login a `routes/`) y quitar `uploads/` cuando se toque esa zona |
| **B8** | `jwt.verify` y `jwt.sign` no fijan el algoritmo (`algorithms: ['HS256']`) | Fijarlo: no depender del valor por defecto de la librería |
| **B9** | Los errores de S3 (`NoSuchKey`) responden 500 porque el error del SDK no trae `status` ni `statusCode` (su código HTTP está en `$metadata.httpStatusCode`), aunque `errorHandler` les da un mensaje legible **(por confirmar la forma del error)** | Mapear `NoSuchKey` a 404 en `errorHandler` |
| **I1** | `.env.example` usa `AWS_BUCKET_NAME=sigmetum-dev`, pero el bucket de dev en `sigmetum-infra` es `sigmetum-app-dev` | Alinear el ejemplo con la infraestructura |

Lo que está bien: contraseña con bcrypt, JWT con caducidad, límite de intentos en el login, CORS restringido, credenciales AWS por rol o SSO (con IAM mínimo y bucket no público, versionado y cifrado en `sigmetum-infra`), trazas de pila solo en local, `.env*` en `.gitignore`, sin `eval` ni `child_process`, y todas las rutas que modifican estado protegidas salvo `POST /log` y `POST /send-email`.

## Discrepancias con el frontend

La fuente de verdad de lo que **espera** el frontend es su documento `../sigmetum-frontend/docs/integracion/para-backend.md` (sección 6). Aquí se registra el estado **contra este código**. Verificadas el 30/09/2026 contra el frontend de `feature/sigmetum_front_v2`. Ninguna está corregida.

| Id | Vigente | Evidencia en este repositorio | Responsable | Acción | Hallazgos relacionados |
|---|---|---|---|---|---|
| **D1** | Sí | `/list-files` devuelve claves `.xlsx`; `GET /get-data/:path(*)` llama a `getFileFromS3`, que hace `JSON.parse` del objeto. `FileDropdown` pide `/get-data/<clave .xlsx>`. El error exacto no se probó contra un S3 real **(por confirmar)** | **Backend** y frontend | Backend: endpoint que convierta un Excel de versión en registros con `convertExcelToJson`, limitado a claves `data/{provincia}/AAAA-MM-DD_vN.xlsx`. Frontend: usarlo | M2 (no cerrar `/get-data` antes) |
| **D2** | Sí | El backend genera `AAAA-MM-DD_vN.xlsx` (`formatFileName.js`); `FormatFileName.js` del frontend espera `Nombre_V3_DD_MM_AAAA.json` | **Frontend** | Adaptar el parser. Backend: no cambiar el formato sin avisar (contrato) | A1 |
| **D3** | Sí | El backend solo hace `workbook.xlsx.load` y no valida `req.file` ni la extensión; el `accept` de `FileUpload` incluye `.csv` y `application/vnd.ms-excel` | **Frontend** y backend | Frontend: aceptar solo `.xlsx`. Backend: validar fichero y extensión | A3 |
| **D4** | Sí | `convertExcelToJson` omite las claves de las celdas vacías; `Table.js` toma las columnas de `Object.keys(data[0])` | **Frontend** | Calcular la unión de claves. Opcional en backend: emitir todas las claves con `null` | — |
| **D5** | Sí | `getPresignedUrlsFromS3Folder` lanza con la carpeta vacía y el handler responde 500 | **Backend** | Devolver `[]` | A5 |
| **D6** | Sí (lado frontend) | `tokenAuth` responde 401 con `Token expired` o `Invalid token`; `services/api.js` solo guarda `error.status` y no redirige | **Frontend** | Ante un 401, borrar el token y redirigir. Backend: nada | — |
| **D7** | Sí (lado frontend) | El limitador responde 429 con `{ success: false, error }`; `LoginForm` tiene un único `catch` | **Frontend** | Distinguir el 429. Backend: ver M12, que afecta a cuántos intentos cuentan | M12 |
| **D8** | Sí | `routes/data.js` devuelve `processedData` completo en el 400 de `POST /upload` | **Backend** | Omitirlo o limitarlo; mantener `emptyFields[].rowIndex` y `draftKey` | — |
| **D9** | Sí (informativo) | `getPresignedUrlsFromS3Folder` y `getPresignedUrlFromS3` usan `expiresIn: 3600` | Ninguno (decisión de producto) | Subir `expiresIn` o refrescar desde el frontend si molesta | — |

## Resueltos

Ninguno todavía.

## Prioridades sugeridas

1. **M16** (dependencias): `npm audit fix` sin `--force` y revisar `nodemailer`. Es lo que pone en rojo `npm run quality` y afecta a autenticación y correo.
2. **A7** (login que se cuelga) y **A3** (entradas sin validar): cambios pequeños que evitan conexiones colgadas y errores 500. Cierra parte de D3.
3. **A1** (zona horaria del versionado) y **A4** (provincia sin validar): evitan pérdida y corrupción de datos.
4. **D1**: endpoint para abrir una versión. Solo después, **M2** (cerrar `/get-data`). Junto con **M3** (límite y validación en `/send-email`).
5. **M12** (`trust proxy`), antes de fiarse del límite del login en prod; **M15** y **M17** (validar el entorno y no revelar errores internos).
6. **A2** (borradores aparte) y **A6** (distinguir "no existe" de "error" en `getTextJsonS3`).
7. **M13** y **M14** (app exportable y capas separadas), y con ellos **M11**: tests del flujo de datos, y luego los tests de contrato que recomienda el frontend.
8. **D5/A5** y **D8**: respuestas más ligeras y sin errores falsos.
9. **M7** y **M8**: paralelizar y cachear `/get-merged-data`.
