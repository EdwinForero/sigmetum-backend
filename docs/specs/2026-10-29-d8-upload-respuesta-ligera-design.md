# D8 (parte backend): respuesta ligera en el 400 de borrador de POST /upload: spec

Fecha: 2026-10-29 · Estado: cerrado

## Objetivo

`POST /upload` responde, cuando el Excel trae celdas vacías, un `400` con `data.processedData` completo (todas las filas) y `data.emptyFields[].rowData` (cada fila con vacíos repetida). El frontend no usa ninguno de los dos, así que es peso innecesario (D8 / F2). El 400 de borrador debe llevar solo lo que el frontend consume: `emptyFields[].rowIndex` y `draftKey`.

Comportamiento actual (`routes/data.js`): `data` lleva `emptyFields` (`{ rowIndex, rowData }`), `processedData`, `draftKey` y `actionRequired`.

## Decisiones tomadas

1. Cuerpo del 400 de borrador, sin campos nuevos (sin `totalRows`):
   `{ success: false, error: 'Some rows have empty fields.', data: { emptyFields: [{ rowIndex }], draftKey, actionRequired: ... } }`.
   Nota: `actionRequired` está dentro de `data` (`routes/data.js`) y se mantiene donde está, con el mismo texto. La forma exacta queda fijada por la prueba del criterio de código 1.
2. Compatibilidad confirmada: compatible, sin `/api/v2`. Evidencia: `sigmetum-frontend/src/components/FileUpload.js`, líneas 66-71, solo usa `responseData.data.emptyFields[].rowIndex` y `responseData.data.draftKey`; `FileUpload.test.js` solo siembra `{ emptyFields: [{ rowIndex: 3 }], draftKey }`; ningún otro archivo de `src/` usa `processedData` ni `rowData`.
3. Tamaño real: no se mide; basta el hallazgo.
4. Se exige una prueba que fije la forma completa del 400 y que falle antes del cambio.
5. `actionRequired` se mantiene tal cual.

## Criterios de aceptación

### De código

1. Nueva prueba en `tests/` (S3 simulado, Excel con celdas vacías) (`tests/upload-excel.test.js`, filas 3 y 5 con celdas vacías) que comprueba con `deepEqual` la forma completa del cuerpo del 400 de borrador (`success`, `error` y `data` con `emptyFields`, `draftKey` y `actionRequired`): `emptyFields` igual a `[{ rowIndex }]` con los números de fila esperados, `draftKey` con formato `data/{provincia}/AAAA-MM-DD_vN.xlsx`, y que `processedData` y `rowData` no aparecen. Debe fallar antes del cambio por ese motivo y pasar después.
2. Los casos existentes de `tests/upload-excel.test.js` (error y `draftKey` del borrador) siguen pasando.
3. No cambia nada más de `POST /upload` (200 sin vacíos, 400 de validación, Excel guardado como borrador sin activarse) ni `POST /upload/confirm`.
4. `convertExcelToJson` sigue devolviendo `{ processedData, emptyFields }` con `rowData` si no hace falta tocarlo; la ruta decide qué expone (por confirmar con `architect`).
5. `npm test`, `npm run lint`, `npm run quality` y `npm run docs:check` pasan; se sube `MIN_TESTS` en `scripts/quality-check.mjs` si se añaden tests.

### De documentación

1. `docs/04-api.md`: el ejemplo y la descripción del 400 de borrador muestran `emptyFields: [{ rowIndex }]` y `draftKey` sin `processedData` ni `rowData`.
2. `docs/05-modulos.md`: la fila de `POST /upload` y la nota que dice que la fila "también se incluye en `processedData`" reflejan lo implementado.
3. `docs/07-estado-y-deuda-tecnica.md`: D8 (parte backend) resuelto con fecha; fecha "actualizado" renovada; cifras solo en la tabla de métricas.
4. `docs/integracion/para-frontend.md`: F2, la fila de `POST /upload` y la tabla de coordinación reflejan el cierre y la forma final; se avisa de que `docs/integracion/para-backend.md` del frontend (sección 6, D8) debe actualizarse en su repositorio. Este repositorio no lo edita.
5. `docs/guias/mantenimiento.md` sección 6: se revisa y se menciona en el resumen final (toca el contrato).

## Fuera de alcance

- A2 (borradores en prefijo propio) y M14.
- M9 y el límite de 10 MB (M6).
- Cambios en el frontend o en `sigmetum-infra`.
- `POST /upload/confirm` y el flujo de versiones.
- Campos nuevos en el 400 y cualquier cambio de `error` o `actionRequired`.

## Impacto en contratos externos

- `docs/integracion/para-frontend.md`: cambia la forma del 400 de `POST /upload` (se eliminan `data.processedData` y `data.emptyFields[].rowData`). Compatible, sin `/api/v2` (evidencia en Decisiones, punto 2). Requiere aviso para actualizar el documento del frontend (sección 6, D8).
- `docs/integracion/para-infra.md`: no lo afecta.

## Preguntas abiertas

Ninguna.
