# Aviso para PR: S15 y M25, AccessDenied en el glosario y lista de permitidos de GET /get-data

Fecha: 2026-10-30 · Spec: [design](2026-10-30-s15-m25-accessdenied-y-get-data-design.md) · Plan: [plan](2026-10-30-s15-m25-accessdenied-y-get-data-plan.md)

## Qué cambia

1. **`GET /get-data/:path`** valida la clave con una lista de permitidos (`isValidGetDataKey`): una versión `data/<provincia>/AAAA-MM-DD_vN.xlsx` o un activo `data/active/<provincia>.json`. **Las claves malformadas pasan de `500` a `400`** `{ "success": false, "error": "Invalid path" }`, sin llamar a S3 (traversal, otras raíces, `data/terms`, `data/drafts`, más de 120 caracteres, provincia inválida o no NFC, clave vacía).
2. **`GET /get-data` con una clave permitida pero inexistente** responde `404` `The requested file does not exist in storage` con `NoSuchKey` y también con `AccessDenied` (antes `500` con `AccessDenied`).
3. **`GET /list-terms`** responde `200` `data: []` también cuando S3 devuelve `AccessDenied` al leer un glosario inexistente (antes `500`).
4. **Sin cambios**: `POST /upload-term` y `DELETE /delete-term` con `AccessDenied` siguen en `500` y no escriben (un permiso roto nunca sobrescribe el glosario, A6).
5. **Los `.xlsx` siguen en `500`** (`JSON.parse` de un binario, `frontend:D1`): pasan la lista de permitidos pero no se pueden abrir con esta ruta. M2 sigue abierto.
6. **`ALLOWED_ORIGIN` es una lista separada por comas** (corrección de documentación: `app.js` divide por `,`, recorta espacios y compara cada origen de forma exacta). No hay cambio de código.

Cambio compatible, sin `/api/v2`. **Límite**: `GET /list-files` devuelve cualquier clave bajo `data/` que no sea carpeta reservada, aunque no cumpla `AAAA-MM-DD_vN.xlsx` ni la regla de provincia (archivos antiguos, `.json` sueltos). Esas claves pasarían en `get-data` de `200` o `500` a `400`. Si existen en dev o prod: **(por confirmar)**. El fixture de `tests/rutas-publicas.test.js` cambió de `/get-data/data/malaga/x.json` (clave inventada) a `/get-data/data/active/Malaga.json`.

**Riesgos aceptados**: con un permiso roto, `list-terms` devuelve `[]` y `get-data` da `404` (se ve como «no existe»; la causa queda en el log). La detección de `AccessDenied` está duplicada en tres sitios (`aws/`, `routes/data.js`, `errorHandler`): deuda menor.

## Antes del apply de infra

1. **Orden de despliegue: primero este backend, después el `apply` de infra** (que acota `s3:ListBucket` por `Prefix`, infra:S7). Con el `apply` antes, `GET /list-terms` daría `500` sin glosario creado.
2. **Mitigación temporal**: subir `[]` a `data/terms/noLatinTerms.json` en dev y en prod. Es obligatoria para poder dar de alta el primer término (hasta entonces el primer alta falla con `500`); no es necesaria para `get-data`. Quién la hace: **(por confirmar)**.
3. Confirmar en dev qué código devuelve S3 para una clave inexistente con la política nueva (`NoSuchKey` o `AccessDenied`): **(por confirmar)**. El backend cubre los dos.

## Integración

- **Frontend (`sigmetum-frontend`)**: compatible (F17 en `docs/integracion/para-frontend.md`). `FileDropdown` es el único uso de `get-data` en `src/`; sus claves estándar siguen pasando la lista de permitidos, y no se encontró ninguna llamada con `data/active/...`. Que muestre bien el `400` y el `404` está **(por confirmar)**.
- **Infraestructura (`sigmetum-infra`)**: sin variables, permisos IAM ni endpoints nuevos; sí el orden de despliegue, la mitigación manual y la corrección de `ALLOWED_ORIGIN` (lista por comas) en `docs/integracion/para-infra.md`. Permisos que necesita el backend: `GetObject`, `PutObject`, `DeleteObject` y `ListBucket` con `Prefix` en `gallery/` y `data/` (que todos los listados lleven `Prefix` en ese ámbito: **por confirmar**).

## Para quien revisa

- Código: `aws/awsS3connect.js` (`getTextJsonS3` con la opción `vacioSiAccessDenied`, por defecto estricta), `routes/content.js` (`list-terms`), `routes/data.js` (`get-data`), `functions/validateDataKey.js` (`isValidGetDataKey`).
- Pruebas: `tests/claves-cliente.test.js`, `tests/s3-robustez.test.js` y `tests/rutas-publicas.test.js` (`MIN_TESTS` 1498).
- Cierre: `npm run lint`, `npm run quality`, `npm run docs:check`, `npm test` y `npm run docs:gate`.
