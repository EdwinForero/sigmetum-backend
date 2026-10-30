# Aviso para PR: M14 (capas separadas) y M11 parcial (flujo de datos con S3 simulado con estado)

Fecha: 2026-10-29 · Spec: [design](2026-10-29-m14-m11-capas-y-flujo-de-datos-design.md) · Plan: [plan](2026-10-29-m14-m11-capas-y-flujo-de-datos-plan.md)

## Qué cambia

Refactor interno: `aws/` solo hace I/O, las reglas de la versión activa pasan a `functions/activeVersion.js` (puro), `getNextVersion` recibe el listado de la carpeta en vez de llamar a S3 y la orquestación (`activateFrom`, `removeVersion`) vive en funciones privadas de `routes/data.js`. `deleteFileFromS3(key)` borra una clave y `putJsonToS3(key, data)` es nueva; `updateFileS3` desaparece. Se añaden un doble de S3 con estado y tests de caracterización, de flujo de extremo a extremo y de capas.

Integración: sin impacto — refactor sin cambio observable: mismas rutas, respuestas, claves de S3 y operaciones de S3 (Get/Put/Delete/List)

- Frontend: nada que hacer. Rutas, envoltorio, textos de error, nombres de versión y orden de despliegue no cambian.
- Infraestructura (`sigmetum-infra`): nada que hacer. Mismas operaciones de S3 en el mismo orden; los permisos de `para-infra.md` no cambian.

## Cambio de logs (único cambio visible fuera de la API)

- Desaparecen `Error deleting file: ...` (envolvía toda la secuencia de borrado) y `Error setting active version: ...`.
- Los fallos de `convertExcelToJson` ya no se registran desde `aws/`: los registra `errorHandler`.
- `deleteFileFromS3` conserva su log solo para el `DeleteObject`; `putJsonToS3` registra `Error writing JSON: ...`.
- Si hay alarmas o búsquedas por esos textos, hay que actualizarlas **(por confirmar: no se ha comprobado si existen)**.

## Riesgo conocido, no corregido (A9 en docs/07)

El comportamiento actual, que el refactor conserva y los tests fijan: cancelar un borrador o borrar una versión regenera el activo desde la última versión que queda. Dos variantes:

1. Si el activo se había puesto en una versión antigua con `POST /update-file`, cancelar un borrador lo sobrescribe con la última.
2. Caso peor: se suben dos borradores con celdas vacías el mismo día y se cancela el segundo; el activo se regenera desde el primero, un borrador **sin confirmar** y con datos incompletos, que pasa a servir `GET /get-merged-data`.

Corregirlo es decisión del usuario; guardar los borradores en un prefijo propio (A2) lo resolvería de raíz.

## Verificación

`npm test`, `npm run lint` (4 avisos, tope 4), `npm run quality`, `npm run docs:check` y `npm run docs:gate` en verde. Los tests de caracterización y de flujo se escribieron antes del refactor y no cambiaron después.
