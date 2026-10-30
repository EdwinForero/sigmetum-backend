# Aviso para PR: A2 y A9, borradores de POST /upload en un prefijo propio

Fecha: 2026-10-29 · Spec: [design](2026-10-29-a2-a9-borradores-prefijo-propio-design.md) · Plan: [plan](2026-10-29-a2-a9-borradores-prefijo-propio-plan.md)

## Qué cambia

El Excel de una subida con celdas vacías ya no se guarda como versión en `data/{provincia}/`. Pasa a `data/drafts/{provincia}/<uuid>.xlsx` (UUID generado por el servidor). Consecuencias para quien consume la API:

- `draftKey` del `400` de `POST /upload`: antes `data/Malaga/2026-01-15_v2.xlsx`, ahora `data/drafts/Malaga/<uuid>.xlsx`. Es opaco: solo se reenvía tal cual a `POST /upload/confirm`.
- `GET /list-files` ya no muestra borradores (ni como versión ni como provincia `drafts`).
- `POST /upload/confirm` con `confirmed: true` crea la versión definitiva al confirmar (`vN` sobre versiones reales), regenera el activo y borra el borrador. La respuesta no devuelve la clave definitiva.
- `POST /upload/confirm` con `confirmed: false` solo borra el borrador: ya no toca versiones ni el activo (A9 resuelto).
- Estado nuevo: `404` `{ "success": false, "error": "Draft not found" }` al confirmar o cancelar un borrador que ya no existe (confirmado, cancelado o sustituido por una subida posterior de la provincia).
- `400` `Invalid draftKey` si se envía una clave de versión a `/upload/confirm`; `400` `Invalid fileName` si se envía una clave de borrador a `/update-file` o `/delete-file`.

Integración: compatible, sin `/api/v2` (el `draftKey` es opaco). Evidencia pendiente de comprobar: **(por confirmar)** que `sigmetum-frontend/src/components/FileUpload.js` solo reenvía el `draftKey` y que ante el `404` muestra un error genérico.

## Qué debe hacer cada repositorio

- **Frontend (`sigmetum-frontend`)**: no interpretar el `draftKey`; tener en cuenta el `404` `Draft not found` en confirmar y cancelar; actualizar `docs/integracion/para-backend.md` (fila de `POST /upload` y `POST /upload/confirm`). Orden de despliegue libre.
- **Infraestructura (`sigmetum-infra`)**: prefijo nuevo `data/drafts/` (solo convención de clave, sin configuración del bucket); sin variables de entorno, permisos IAM ni endpoints nuevos (`GetObject`, `PutObject`, `DeleteObject` y `ListBucket` ya los concede la política). El chequeo de existencia del borrador usa `ListBucket`: confirmar **(por confirmar)** que el perfil SSO local lo conserva.

## Para quien despliega

- **Revisar y borrar a mano los borradores anteriores al despliegue**: los Excel que quedaron como borrador sin confirmar siguen en `data/{provincia}/` como versiones (no hay migración) y pueden activarse al borrar otra versión.

## Límites aceptados

- Repetir una confirmación que se interrumpió antes de borrar el borrador crea la versión siguiente con el mismo contenido (duplicado).
- Si el descarte de borradores falla tras una subida completa, el cliente recibe 200 y queda un borrador viejo hasta la siguiente subida de esa provincia.
- Dos subidas con vacíos simultáneas de la misma provincia pueden borrarse mutuamente los borradores (ambos `draftKey` darían 404); una confirmación en curso mientras entra una subida completa puede sobrescribir el activo nuevo con datos más antiguos (M1, fuera de alcance).
- Un borrador de 0 bytes no se lista y daría 404.
- `GET /get-data/:path(*)` puede leer cualquier clave, borradores incluidos (M2, fuera de alcance).

## Para quien revisa

- `routes/data.js`: `POST /upload` (borrador, `discardDrafts`), `POST /upload/confirm` (`isValidDraftKey`, 404, confirmar convierte antes de escribir y escribe el activo sin releer). `config/s3Paths.js`, `functions/activeVersion.js` y `functions/validateDataKey.js`.
- Tests: `tests/borradores-prefijo.test.js` (nuevo) y cambios a propósito en las pruebas de caracterización, flujo, subida, claves del cliente y robustez de S3; `MIN_TESTS` sube a 1037.
- Documentos: `docs/04-api.md`, `docs/05-modulos.md`, `docs/06-almacenamiento-s3.md`, `docs/README.md`, `docs/integracion/para-frontend.md`, `docs/integracion/para-infra.md`, `docs/guias/seguridad.md`, `docs/guias/buenas-practicas-backend.md`, `docs/guias/mantenimiento.md`, `docs/07-estado-y-deuda-tecnica.md`.
