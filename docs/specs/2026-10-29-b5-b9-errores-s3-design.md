# Errores de S3 coherentes (B5 y B9): spec

Fecha: 2026-10-29 · Estado: cerrado

## Objetivo

Hoy las funciones de `aws/` mezclan dos estilos de error: unas lanzan y otras (`deleteImageFromS3`, `deleteTermFromS3`) devuelven `{ success: false }`, y las rutas tienen que tratar ambos. Además, el error de S3 `NoSuchKey` responde `500` porque el error del SDK no trae `status` ni `statusCode` (su código HTTP está en `$metadata.httpStatusCode`), aunque `errorHandler` ya le da un mensaje legible. Esta spec cubre B5 (un solo estilo: todo error de S3 se lanza y lo trata `errorHandler` vía `next(error)`) y B9 (`NoSuchKey` responde `404`, de forma global en `errorHandler`). Se entregan juntas, en un solo ciclo y un solo commit.

Comportamiento actual (leído del código, 29/10/2026):

- `DELETE /delete-image` y `DELETE /delete-term`: cualquier fallo de S3 responde `500` `Internal server error`, incluso `NoSuchBucket` o `AccessDenied`, porque `aws/` aplana el error a un texto y la ruta crea un `Error` nuevo sin código (M17). `delete-term` además pierde el código al envolver (matiz de A6: `AccessDenied` da `Access denied to storage` en `list-terms` y `upload-term`, pero `Internal server error` en `delete-term`).
- `errorHandler` ya mapea por código: `NoSuchKey` a `The requested file does not exist in storage`, `NoSuchBucket` a `Storage bucket is not configured correctly`, `AccessDenied` a `Access denied to storage`, `NetworkingError`/`ECONNREFUSED` a `Storage connection error`. Estos textos no cambian.
- `getTextJsonS3` convierte `NoSuchKey` en lista vacía dentro de `aws/` (A6): ese error no llega a `errorHandler`.
- `getPresignedUrlFromS3` solo firma la URL sin llamar a S3.
- `DeleteObject` de S3 es idempotente: borrar una clave inexistente responde éxito.

## Decisiones tomadas (usuario, 29/10/2026)

- B9 es **global en `errorHandler`**: cualquier `NoSuchKey` (en `name` o en `Code`) que llegue por `next(error)` responde `404` con el mensaje fijo `The requested file does not exist in storage`, sin eco de la clave ni de `err.message`. Un `status` o `statusCode` propio del error sigue mandando. `NoSuchBucket` sigue en `500`. Un `code` en minúscula con valor `NoSuchKey` sigue en `500` con el texto mapeado (límite conocido, aceptado).
- Rutas que dan `404` en el caso normal: `GET /get-data/:path(*)` con clave inexistente, `POST /update-file` y `POST /upload/confirm` (al confirmar) con un Excel inexistente.
- Rutas que darían `404` solo ante una carrera (el objeto desaparece entre el listado y la lectura): `GET /get-merged-data`, `POST /delete-file` (lectura tras el borrado) y `POST /upload/confirm` al cancelar.
- No cambian: `DELETE /delete-image` (sigue en `200`, `DeleteObject` idempotente), `GET /get-image` (sigue en `200`, solo firma, no llama a S3), `list-terms`/`upload-term`/`delete-term` con glosario inexistente (`200`; A6 captura `NoSuchKey` dentro de `aws/`).
- Mensaje público del `404`: el `error` ya existente `The requested file does not exist in storage`; es distinto de `Not found` (ruta inexistente), así que el cliente distingue «recurso» de «ruta».
- B5: `delete-image` y `delete-term` ante `AccessDenied`, `NoSuchBucket` o fallo de red dan los mismos textos y el mismo `500` que el resto de rutas; compatible (el frontend no usa el texto, M17).
- La forma real del error del SDK (`name`, `Code` o `$metadata`) la confirma el `architect` en `node_modules`; los tests con `S3Client.prototype.send` parcheado deben reproducir esa forma real, no una inventada.

## Criterios de aceptación

### De código

Cada criterio se comprueba con un test en `tests/` (`node:test` + `supertest`, con `S3Client.prototype.send` parcheado) que falle antes del cambio por el motivo correcto. En todos los tests, el error simulado debe tener la forma que produce el SDK real, confirmada por el `architect`.

B5:

1. Con `send` rechazando con `AccessDenied`, `DELETE /delete-image` y `DELETE /delete-term` responden `500` `Access denied to storage` (hoy `Internal server error`).
2. Con `NoSuchBucket`, ambas responden `500` `Storage bucket is not configured correctly`; con error de red, `500` `Storage connection error`.
3. Con un error sin código conocido, ambas responden `500` `Internal server error`; la respuesta nunca incluye `err.message`.
4. Con S3 correcto, ambas responden `200` con `Image deleted successfully` y `Term deleted successfully`, y lo escrito en S3 no cambia.
5. Con un fallo al leer el glosario distinto de `NoSuchKey`, `delete-term` no sobrescribe el glosario (invariante de A6).
6. Ninguna función exportada de `aws/` devuelve `{ success: false }`: ante un fallo del SDK, `deleteImageFromS3` y `deleteTermFromS3` rechazan con el error original.
7. Los `400` de validación de ambas rutas no cambian.

B9 (global en `errorHandler`):

8. Con `NoSuchKey`, `GET /get-data/<clave>` responde `404` `{ success: false, error: "The requested file does not exist in storage" }` (hoy `500`).
9. Con `NoSuchKey` al leer el Excel, `POST /update-file` y `POST /upload/confirm` (con `confirmed` verdadero) responden `404` con el mismo mensaje.
10. Caso normal frente a carrera: las tres rutas de los criterios 8 y 9 dan `404` en el caso normal. Solo ante una carrera (el objeto desaparece entre el listado y la lectura) dan también `404`, y se fija con tests con `send` parcheado: `GET /get-merged-data` (el listado devuelve la clave y la lectura rechaza con `NoSuchKey`), `POST /delete-file` (el borrado tiene éxito y la lectura posterior rechaza con `NoSuchKey`) y `POST /upload/confirm` al cancelar.
11. `DELETE /delete-image` sobre una clave inexistente sigue respondiendo `200` (S3 devuelve éxito); `POST /delete-file` de una clave inexistente sin carrera sigue en `200`.
12. `GET /get-image` sobre una clave inexistente sigue respondiendo `200` con `imageUrl` y no llama a S3 (una prueba lo demuestra: `send` no se invoca).
13. Con glosario inexistente (`NoSuchKey` al leerlo), `list-terms` responde `200` `[]`, `upload-term` responde `200` y lo crea, y `delete-term` responde `200`; ninguno da `404` (A6 captura el error dentro de `aws/`).
14. `NoSuchBucket`, `AccessDenied` y los errores de red conservan `500` y su mensaje; solo `NoSuchKey` cambia de estado.
15. Un error con `status` o `statusCode` propio (JWT, multer, JSON mal formado, `publicMessage`) conserva su estado, también si además es `NoSuchKey`.
16. El `NoSuchKey` se detecta tanto en `name` como en `Code`; un `code` en minúscula con `NoSuchKey` sigue en `500` con el texto mapeado (límite conocido, fijado por un test).
17. El `404` no incluye en el cuerpo la clave pedida ni `err.message`.

General:

18. `npm test`, `npm run lint`, `npm run quality` y `npm run docs:check` pasan; si se añaden tests, se sube `MIN_TESTS`; `npm run docs:gate` pasa antes del commit.

### De documentación

1. `docs/07-estado-y-deuda-tecnica.md`: B5 y B9 resueltos con fecha (y hash tras el commit); M17 y el matiz de A6 sobre `delete-term` actualizados; fecha "actualizado" y métricas (tests) al día. Se documentan los riesgos y límites de abajo.
2. `docs/04-api.md` y `docs/05-modulos.md`: `404` en las rutas (caso normal y carrera), mensajes de `delete-image` y `delete-term`, y estilo único de error de `aws/`.
3. `docs/06-almacenamiento-s3.md`: todas las funciones de `aws/` lanzan ante un fallo.
4. `docs/integracion/para-frontend.md`: nueva fila en la sección 1 (B9 compatible condicionada); sección 2: el `404` ya no es solo de rutas inexistentes (reescribir la fila de «no usados hoy» y retirar el efecto conocido de B5); sección 5 sin cambios de código en el frontend.
5. `docs/guias/mantenimiento.md` sección 6 revisada y dicho en el resumen final.
6. Aviso para PR en `docs/specs/*-aviso-pr.md`: marca B9 como el único cambio que añade un estado nuevo (`404`) y B5 como cambio solo de texto en `500`; incluye los riesgos de abajo.

Riesgos y límites a documentar (docs/07 y aviso para PR):

- Un fallo de datos a mitad de una operación se lee como «no existe»: en `POST /delete-file`, una lectura que da `NoSuchKey` tras un borrado que sí ocurrió responde `404` aunque el objeto se borró.
- El frontend no distingue `404` de `500` (`error.status` sin uso, M17): compatible condicionada, **(por confirmar)** contra su código (`FileUpload.js` usa `fetch` propio).
- **(Por confirmar)** `s3:ListBucket` del perfil SSO local: sin ese permiso, S3 responde `AccessDenied` en vez de `NoSuchKey` ante una clave inexistente y B9 podría no verse en local.
- Límite conocido: un `code` en minúscula con valor `NoSuchKey` da `500` con el texto mapeado.

## Fuera de alcance

- A2, D8, M14 y M8.
- Mapear `NoSuchBucket` a `404` (se queda en `500`).
- Cambiar el comportamiento idempotente de `DELETE /delete-image` y `POST /delete-file`.
- Hacer que `GET /get-image` compruebe la existencia del objeto.
- Cambiar A6 (`NoSuchKey` sigue siendo lista vacía en el glosario).
- Cambios en el frontend o en `sigmetum-infra`.

## Impacto en contratos externos

- `docs/integracion/para-frontend.md`: afectado.
  - B9 añade un estado visible: `404` ante un recurso ausente en S3 (caso normal en `GET /get-data`, `POST /update-file` y `POST /upload/confirm`; ante carrera, también `GET /get-merged-data`, `POST /delete-file` y `POST /upload/confirm` al cancelar). Hoy el documento dice que el `404` solo se emite para rutas inexistentes y que un recurso ausente da `500`.
  - Clasificación: compatible condicionada. `services/api.js` guarda `error.status` y `error.serverMessage`, pero según el documento ningún componente los usa (28/10/2026). Que el frontend no interprete el `404` como «no existe» **(por confirmar)** contra su código (`FileUpload.js` usa `fetch` propio y `FileDropdown`). Si lo interpretara, sería incompatible.
  - B5 solo cambia el texto de los `500` de `delete-image` y `delete-term` a los mapeados; el frontend no usa el texto (M17): compatible.
- `docs/integracion/para-infra.md`: no lo afecta (sin variables de entorno ni permisos IAM nuevos); el `s3:ListBucket` del perfil SSO local es solo una comprobación **(por confirmar)** para verlo en local.

## Preguntas abiertas

Ninguna. La forma real del error del SDK la confirma el `architect` (no es una decisión de producto).
