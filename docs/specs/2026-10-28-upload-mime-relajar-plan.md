# Relajar la comprobación de MIME en POST /upload: plan

Fecha: 2026-10-28 · Estado: cerrado · Spec: [2026-10-28-upload-mime-relajar-design.md](2026-10-28-upload-mime-relajar-design.md)

Crítico: sí (entrada "contrato con el frontend" de `criticidad`: cambia el comportamiento visible de `/upload` y `routes/**` está en `areasContrato`).

## Supuestos y decisiones

- Retirar el MIME no contradice `docs/guias/seguridad.md` (línea 79, "Se valida la extensión y el tipo: `.xlsx` para datos…"): para los datos, el "tipo" exigido es la extensión `.xlsx`, que se mantiene. El MIME lo manda el cliente, así que no es una defensa real. Sin él, cualquier fichero con nombre `.xlsx` se carga entero en memoria (`multer.memoryStorage()` sin `limits`, `routes/data.js:20`) y `exceljs` lo descomprime sin límite (M6, M9): sigue fuera de alcance y como estaba, pero queda dicho. La mitigación real es que la ruta exige JWT y es solo del administrador. La validación de la provincia (A4) también queda como estaba. La fila sigue en "No cumple" por D3/M5, que no cambian; la lista blanca de MIME de `/upload-image` sigue pendiente en M5 (allí el backend sigue confiando en el MIME).
- Se mantiene `path` en `routes/data.js`: lo sigue usando la comprobación de extensión.
- Alternativa descartada: dejar `ALLOWED_XLSX_MIMES` con más valores; la spec (decisión 1) pide retirar la constante.

## Fase 1

1. **Quitar la comprobación de MIME en `POST /upload`**
   - Archivo: `routes/data.js` (modificar).
   - Cambios: se elimina la constante `ALLOWED_XLSX_MIMES` y su comentario (líneas 22-27); la condición de la línea 82 pasa a `if (!isXlsx) {`; el 400 `'Only .xlsx files are allowed'` y su formato `{ success: false, error }` se mantienen; se deja una línea de comentario que diga que el MIME lo manda el cliente y que la extensión es la comprobación. No se toca nada más (ni `multer`, ni `File is required`, ni el resto del flujo). No cambia ninguna ruta, firma ni respuesta.
   - Comprobación (sin tests, M11; servidor con `npm start` en puerto libre, entorno ficticio, `NODE_ENV=test`, JWT válido):
     - Criterio 1: `curl -F "file=@x.xlsx;type=application/vnd.ms-excel"`, y lo mismo con `application/x-zip-compressed`, `text/plain` y sin `type`: ninguna devuelve `400 Only .xlsx files are allowed`. Con un `.xlsx` válido y sin S3 real, el flujo falla más adelante (`getNextVersion` o S3): eso demuestra que se pasó la validación; la subida completa queda **(por confirmar si hay entorno S3)**. Lo mismo con `X.XLSX`.
     - Criterio 2: `x.xls`, `x.xlsm`, `x.csv` y `x.txt`, cada uno con `type` de xlsx y con otro MIME: todos dan `400 Only .xlsx files are allowed`.
     - Criterio 3: sin fichero → `400 File is required`; con `-F "otro=@x.xlsx"` → `400` por `MulterError`.
     - Criterio 4: un `.txt` renombrado a `.xlsx` llega a `convertExcelToJson`; se anota el código y el mensaje reales que devuelva (se espera `500` por `errorHandler` con el `err.message` crudo de `exceljs`, M17, preexistente) como comportamiento actual, sin corregirlo. Se prueba también un libro vacío (se espera un `TypeError` en `worksheets[0]`, **por confirmar** con lo observado).
     - MIME observado: `curl` sin `type` puede enviar `text/plain` u `octet-stream`; se anota el valor realmente recibido (con un log temporal que se revierte, o reflejando la cabecera con un servidor mínimo aparte, sin dejar nada en el repositorio).
     - Criterio 5: `npm run lint` y `npm run quality` pasan.
   - Norma: `buenas-practicas-backend.md` (fila `POST /upload`); `seguridad.md` línea 79 (sin cambio de estado); `para-frontend.md` (compatible: se acepta más, sin `/api/v2`); "cada ruta responde `{success, data}` o `{success, error}`".

## A cargo del tester-documentador

- `docs/04-api.md` (línea ~87): `POST /upload` rechaza con `400 Only .xlsx files are allowed` solo la extensión distinta de `.xlsx`, sin distinguir mayúsculas; el MIME no se comprueba porque lo manda el cliente; eliminar el "por confirmar con un navegador real".
- `docs/05-modulos.md` (líneas ~68-69): borrar la fila `ALLOWED_XLSX_MIMES`; en la fila `POST /upload`, "extensión distinta de `.xlsx` → 400" sin la constante.
- `docs/guias/buenas-practicas-backend.md` (línea ~62): validación "extensión `.xlsx` (400)"; motivo: el MIME lo manda el cliente y no se comprueba.
- `docs/guias/seguridad.md` (línea ~79): reescribir "extensión y tipo" como extensión `.xlsx` para datos, con el MIME no comprobado porque lo manda el cliente; sin cambiar el estado "No cumple (D3, M5)". Citar M6 y M9 como lo que sigue sin cubrir (carga en memoria sin límite y descompresión sin límite).
- Límites de la documentación: acotar todo a `/upload`; no dar a entender que el backend ignora el MIME en todas partes (`/upload-image` sigue confiando en él, M5).
- `docs/07-estado-y-deuda-tecnica.md`: revisar por separado las líneas ~72 y ~74 (mencionan el MIME); no tocar la fila M5 de `/upload-image`.
- Dejar intactos los ficheros históricos de A7/A3 (`design`, `plan` y `aviso-pr`).
- `docs/integracion/para-frontend.md` (línea ~66 y fila D3 ~79): criterio solo por extensión `.xlsx`; quitar el "por confirmar" resuelto; añadir de forma explícita que `.xls` y `.xlsm` dan `400` por extensión desde el 28/10/2026; el `accept` del frontend sigue siendo D3.
- `docs/07-estado-y-deuda-tecnica.md`: fecha "actualizado" de hoy; registro de la iteración; fila D3 (quitar "MIME tolerante"); revisar otras menciones del MIME.
- **Aviso para PR nuevo** `docs/specs/2026-10-28-upload-mime-relajar-aviso-pr.md` (decisión 4): comprobación de MIME retirada (compatible); `.xls` y `.xlsm` rechazados por extensión como cambio visible; el 500 que persiste con un no-xlsx renombrado a `.xlsx` (por confirmar), y que sin MIME se acepta en memoria cualquier fichero con nombre `.xlsx` (M6 y M9 siguen abiertos; la ruta exige JWT y es solo del administrador); el aviso de A7/A3 queda como estaba y no se toca.
- Cierre: `npm run docs:check` y `npm run docs:gate` antes del commit. Proponer el mensaje de commit.

## Pruebas

Sin base de tests (M11): peticiones `curl` del paso 1, más `npm run lint`, `npm run quality` y `npm run docs:check`. `agentes:test` no aplica (no se toca `plugins/`).

## Cierre

- Documentos de `integracion` afectados: `para-frontend.md` (cambio compatible). `para-infra.md` no se ve afectado.
- Campos opcionales de `flujo.json`: todos presentes. `consultor` es "ninguno".
