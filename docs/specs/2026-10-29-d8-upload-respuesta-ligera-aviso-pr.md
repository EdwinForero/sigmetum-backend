# Aviso para PR: D8, respuesta ligera en el 400 de borrador de POST /upload

Fecha: 2026-10-29 · Spec: [design](2026-10-29-d8-upload-respuesta-ligera-design.md) · Plan: [plan](2026-10-29-d8-upload-respuesta-ligera-plan.md)

## Qué cambia

El `400` de borrador de `POST /upload` (Excel con celdas vacías) deja de devolver `data.processedData` y `data.emptyFields[].rowData`. Forma nueva:

```json
{ "success": false, "error": "Some rows have empty fields.", "data": {
  "emptyFields": [ { "rowIndex": 7 } ],
  "draftKey": "data/Malaga/2026-01-15_v2.xlsx",
  "actionRequired": "Confirm whether to continue or cancel the upload."
} }
```

No cambian el `200`, el `400` de validación ni `POST /upload/confirm`.

Integración: compatible, sin `/api/v2`. Evidencia: `sigmetum-frontend/src/components/FileUpload.js` (líneas 66-71) solo usa `data.draftKey` y `data.emptyFields[].rowIndex`; `FileUpload.test.js` solo siembra `{ emptyFields: [{ rowIndex: 3 }], draftKey }`; ningún otro archivo de `src/` ni `sigmetum-infra` usa `processedData`, `rowData` ni `actionRequired`. Por confirmar: consumidores fuera de estos dos repositorios.

## Qué debe hacer cada repositorio

- **Frontend (`sigmetum-frontend`)**: avisar a sus responsables para que actualicen `docs/integracion/para-backend.md` (sección 6, D8, y la fila de `POST /upload`). Ningún cambio de código. Orden de despliegue libre.
- **Infraestructura (`sigmetum-infra`)**: sin impacto (sin variables de entorno, permisos IAM ni endpoints nuevos).

## Para quien revisa

- `routes/data.js`: `emptyFields.map(({ rowIndex }) => ({ rowIndex }))` y se elimina `processedData` del 400. `convertExcelToJson` sigue construyendo `rowData` (limpieza opcional, fuera de alcance).
- Test nuevo de forma completa en `tests/upload-excel.test.js`; `MIN_TESTS` sube al total real.
- Documentos: `docs/04-api.md`, `docs/05-modulos.md`, `docs/integracion/para-frontend.md`, `docs/guias/mantenimiento.md`, `docs/07-estado-y-deuda-tecnica.md`.
