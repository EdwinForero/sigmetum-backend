# Aviso para PR: B5 y B9, errores de S3 coherentes y NoSuchKey a 404

Fecha: 2026-10-29 · Spec: `docs/specs/2026-10-29-b5-b9-errores-s3-design.md` · Plan: `docs/specs/2026-10-29-b5-b9-errores-s3-plan.md`

Se tocan áreas de contrato: `middleware/errorHandler.js` y `routes/**` (`routes/content.js`). Además cambia `aws/awsS3connect.js`.

## Qué cambia

- **B9, el único cambio que añade un estado nuevo (`404`)**: cualquier `NoSuchKey` de S3 (por `name` o por `Code`) que llegue a `errorHandler` responde `404` `{ success: false, error: "The requested file does not exist in storage" }` (antes `500` con el mismo texto). El texto es distinto de `Not found` (ruta inexistente) y no refleja la clave ni `err.message`. Un `status` o `statusCode` propio del error sigue mandando.
  - Caso normal: `GET /get-data/:path`, `POST /update-file` y `POST /upload/confirm` al confirmar.
  - Solo en carrera (el objeto desaparece entre el listado y la lectura): `GET /get-merged-data`, `POST /delete-file` y `POST /upload/confirm` al cancelar.
  - Sin cambio: `NoSuchBucket`, `AccessDenied` y errores de red (`500`); `DELETE /delete-image` y `POST /delete-file` ante clave inexistente (`200`); `GET /get-image` (`200`, no llama a S3); glosario inexistente (`200`, A6).
- **B5, cambio solo de texto en `500`**: `deleteImageFromS3` y `deleteTermFromS3` lanzan el error original y las rutas hacen `await` y `next(error)`. `DELETE /delete-image` y `DELETE /delete-term` dan ahora `Access denied to storage`, `Storage bucket is not configured correctly` o `Storage connection error` (y `Internal server error` si el error no trae código), siempre con `500`. El `200` y los `400` de validación no cambian.

## Qué debe hacer cada repositorio

- **Frontend (`sigmetum-frontend`)**: clasificación **compatible condicionada**, sin `/api/v2` (mismo envoltorio y campos; `services/api.js` guarda `error.status` y `error.serverMessage`, pero según `docs/integracion/para-frontend.md` ningún componente los usa). Integración: **(por confirmar)** antes de desplegar, contra `FileUpload.js` (usa `fetch` propio) y `FileDropdown`, que ninguno interpreta el `404` como «no existe» ni distingue `404` de `500`; si lo hace, el cambio es incompatible. Sin cambios de código previstos. Detalle en `docs/integracion/para-frontend.md` (F10).
- **Infraestructura (`sigmetum-infra`)**: sin cambios (no hay variables de entorno, permisos IAM ni endpoints nuevos). Solo la comprobación **(por confirmar)** de `s3:ListBucket` en el perfil SSO local (ver `docs/integracion/para-infra.md`).

## Riesgos y límites

- Un fallo de datos a mitad de una operación se lee como «no existe»: en `POST /delete-file`, un `NoSuchKey` en la lectura posterior a un borrado que sí ocurrió responde `404` aunque el objeto se borró.
- El frontend no distingue `404` de `500` (M17): compatible condicionada, **(por confirmar)**.
- **(Por confirmar)** `s3:ListBucket` del perfil SSO local: sin él, S3 responde `AccessDenied` en vez de `NoSuchKey` ante una clave inexistente y B9 podría no verse en local.
- Límite conocido: un `code` en minúscula con valor `NoSuchKey` (sin `name` ni `Code`) sigue en `500` con el texto mapeado; el SDK real no lo produce. Lo fija un test.
- Un `NoSuchBucket` sigue en `500` (decisión: no se mapea a `404`).
