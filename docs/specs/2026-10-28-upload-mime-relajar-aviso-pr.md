# Aviso para PR: relajar el MIME de POST /upload (28/10/2026)

## Qué cambia

- `POST /upload` deja de comprobar el MIME del fichero (lo manda el cliente y no es fiable): se elimina `ALLOWED_XLSX_MIMES` de `routes/data.js` y solo cuenta la extensión `.xlsx` (sin distinguir mayúsculas). Un `.xlsx` etiquetado como `application/vnd.ms-excel`, `application/x-zip-compressed`, `text/plain` o sin tipo ya no recibe `400`.
- `.xls`, `.xlsm`, `.csv` y `.txt` siguen dando `400` `Only .xlsx files are allowed` con cualquier MIME. Es un cambio visible para el frontend que no se avisó en la PR de A7/A3: `.xls` y `.xlsm` se rechazan por extensión desde el 28/10/2026.
- Sin fichero (`400 File is required`) y `MulterError` (`400`) no cambian. Sin dependencias nuevas, sin cambios en `.env.example` ni en `package.json`.
- `/upload-image` no cambia: sigue confiando en el MIME (M5).

## Frontend

Integración: cambia `docs/integracion/para-frontend.md` (filas "Tipo de fichero en `/upload`" y D3). Cambio compatible (se acepta más; no exige `/api/v2`). Qué debe confirmar el equipo del frontend:

1. `.xls` y `.xlsm` dan `400` por extensión: el `accept` de `FileUpload` (incluye `.csv` y `application/vnd.ms-excel`) permite elegirlos y recibirán `400`. Sigue siendo D3 (aceptar solo `.xlsx`).
2. El aviso de A7/A3 decía que un `.xlsx` sin tipo MIME podía recibir `400`; con este cambio deja de ser cierto y la duda queda resuelta. El aviso de A7/A3 no se toca.

Orden de despliegue: sin orden especial (cambio compatible).

## Infraestructura

Nada: ni variables de entorno, ni permisos de S3, ni endpoints nuevos.

## Para el usuario

- Persiste el `500` con un no-xlsx renombrado a `.xlsx`: llega a `convertExcelToJson` y responde el `err.message` crudo de `exceljs` (M17), por ejemplo `Can't find end of central directory : is this a zip file ?`. Un libro vacío da `500` `Cannot read properties of undefined (reading 'eachRow')`. Comportamiento actual, sin corregir (un `400` propio queda fuera de alcance).
- Sin MIME, cualquier fichero con nombre `.xlsx` se carga entero en memoria y `exceljs` lo descomprime sin límite: M6 y M9 siguen abiertos. La ruta exige JWT y es solo del administrador.
- Prueba manual pendiente **(por confirmar)**: subida completa con S3 real y el MIME que envía un navegador real. Con `curl` sin `type` se observó `application/octet-stream` (servidor mínimo aparte).
- Sin base de tests (M11): las comprobaciones fueron peticiones reales a `npm start` local con entorno ficticio.
