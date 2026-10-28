# Relajar la comprobación de MIME en POST /upload: spec

Fecha: 2026-10-28 · Estado: cerrado

## Objetivo

Hoy `POST /upload` responde `400` `Only .xlsx files are allowed` a un `.xlsx` real cuando el navegador lo etiqueta con un MIME fuera de {el de xlsx, `application/octet-stream`, vacío}, por ejemplo `application/vnd.ms-excel`, `application/x-zip-compressed` o `text/plain`. El MIME lo manda el cliente y no es fiable; la extensión es la comprobación real. Se busca que un `.xlsx` legítimo no sea rechazado por la etiqueta MIME del navegador. Origen: segunda opinión de la iteración A7/A3 (decisión 6 de `2026-10-28-a7-a3-validacion-entradas-design.md` y paso 3 de su plan, que dejó el supuesto de `text/plain` como "por confirmar").

## Criterios de aceptación

### De código

1. `POST /upload` con un fichero de extensión `.xlsx` (sin distinguir mayúsculas) y cualquier MIME (por ejemplo `application/vnd.ms-excel`, `application/x-zip-compressed`, `text/plain` o ausente) ya no responde `400` `Only .xlsx files are allowed`; sigue el flujo normal (decisión 1).
2. `POST /upload` con extensión distinta de `.xlsx` (`.xls`, `.xlsm`, `.csv`, `.txt`) sigue respondiendo `400` `Only .xlsx files are allowed`, con cualquier MIME, incluido el de xlsx.
3. Sin fichero sigue respondiendo `400` `File is required`; un campo con otro nombre sigue dando `400` por `MulterError`.
4. Un `.xlsx` cuyo contenido no es un libro válido: comportamiento actual documentado y sin regresión; si hoy da `500`, queda anotado (pregunta 3).
5. `npm run lint`, `npm run quality` y `npm run docs:check` pasan. Comprobación con peticiones reales (`curl -F "file=@x.xlsx;type=<mime>"`) para cada MIME del criterio 1; la subida completa requiere S3 real **(por confirmar si hay entorno)**.

### De documentación

1. `docs/04-api.md` (sección `POST /upload`, línea ~87): describe el nuevo criterio y elimina el "por confirmar con un navegador real" en lo que quede resuelto.
2. `docs/05-modulos.md` (filas `ALLOWED_XLSX_MIMES` y `POST /upload`, líneas ~68-69): refleja el criterio nuevo o la desaparición de la constante.
3. `docs/guias/buenas-practicas-backend.md` (fila `POST /upload`, línea ~62): criterio de validación actualizado y motivo (el MIME lo manda el cliente).
4. `docs/guias/seguridad.md` (línea ~79, "extensión y tipo"): revisar si la fila sigue siendo exacta; el estado "No cumple" depende de D3/M5 y no debe cambiar sin motivo.
5. `docs/integracion/para-frontend.md` (fila "Tipo de fichero en `/upload`", línea ~66 y fila D3, línea ~79): actualizar el criterio MIME, quitar el "por confirmar" resuelto y añadir de forma explícita que `.xls` y `.xlsm` se rechazan por extensión con `400` desde el 28/10/2026 (la segunda opinión observó que no figuraba como cambio).
6. Se crea un aviso para PR nuevo en `docs/specs/` (decisión 4) que recoge: la comprobación de MIME retirada, el rechazo de `.xls`/`.xlsm` por extensión como cambio visible y que el aviso de A7/A3 queda como estaba.
7. `docs/07-estado-y-deuda-tecnica.md`: fecha "actualizado" de hoy y registro de la iteración (fila D3 incluida si cita el MIME tolerante).

## Fuera de alcance

- Añadir lista blanca de MIME o límite de tamaño en `/upload-image` y `multer` (M5, M6).
- Validar el contenido del fichero (firma zip, estructura del libro) o límites de descompresión (M9).
- Aceptar `.xls` o `.xlsm`; cambiar el `accept` de `FileUpload` en el frontend (D3).
- Cambiar rutas, formato de respuesta, columnas del Excel, JWT o CORS.

## Impacto en contratos externos

- `docs/integracion/para-frontend.md`: lo afecta, de forma **compatible** (se acepta más, no menos; no exige `/api/v2`). Cambia la fila de tipo de fichero en `/upload` y debe constar que `.xls`/`.xlsm` dan `400` por extensión (cambio de comportamiento del 28/10/2026 no avisado hasta ahora). El `accept` del frontend (que incluye `.csv` y `application/vnd.ms-excel`) sigue siendo D3.
- `docs/integracion/para-infra.md`: no lo afecta (sin variables de entorno, IAM ni endpoints nuevos).
- Aviso para PR: obligatorio por tocar `routes/**` (área de contrato) y por el cambio visible para el frontend.

## Decisiones del usuario (28/10/2026)

1. Se quita la comprobación de MIME de `POST /upload`: solo cuenta la extensión `.xlsx`. Se retira `ALLOWED_XLSX_MIMES` y su mención en la documentación.
2. Un fichero que no es xlsx renombrado a `.xlsx` llega a `convertExcelToJson` y, si falla, responde el 500 actual; un 400 propio queda fuera de alcance (por confirmar).
3. `.xls` y `.xlsm` siguen rechazados con 400 por extensión; se documenta como cambio visible en `para-frontend.md` y en el aviso para PR.
4. Se crea un aviso para PR nuevo (el de A7/A3 ya está comprometido).

## Preguntas abiertas

Ninguna.
