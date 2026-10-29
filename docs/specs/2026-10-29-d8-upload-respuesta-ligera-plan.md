# D8 (backend): respuesta ligera en el 400 de borrador de POST /upload: plan

Fecha: 2026-10-29 · Estado: cerrado · Spec: `docs/specs/2026-10-29-d8-upload-respuesta-ligera-design.md`

Crítico: sí (entrada de `criticidad`: «contrato con el frontend»; cambia la forma de una respuesta de `routes/data.js`). Es un cambio compatible, sin `/api/v2`. Segunda opinión sobre el plan: recibida (sin críticos; dos importantes) e incorporada como notas.

## Hallazgos contrastados con el código

- `routes/data.js` (400 de borrador): `{ success:false, error:'Some rows have empty fields.', data:{ emptyFields, processedData, draftKey, actionRequired } }`. `actionRequired` está DENTRO de `data`, junto a los otros tres; no hay `actionRequired` en la raíz.
- `emptyFields` llega tal cual de `convertExcelToJson` (`{ rowIndex: rowNumber, rowData: row.values.slice(1) }`). `rowData` solo se construye ahí y la ruta no lo usa para nada más. `processedData` sí se sigue usando en la ruta (validación de provincia y JSON del 200). `aws/awsS3connect.js` solo desestructura `processedData` de `convertExcelToJson`.
- El 200 devuelve `{ success:true, data:{ message, key } }` y no lleva `processedData`. `/upload/confirm` solo lee `draftKey` y `confirmed` y no se toca.
- Hoy el 400 de borrador solo se prueba en `tests/upload-excel.test.js` (bucle `borradores`): `status`, `error`, formato de `draftKey` y `argsLog.upload.length === 1`. `tests/claves-cliente.test.js` solo cubre `/upload/confirm`.
- Evidencia del frontend (comprobada por el orquestador): `sigmetum-frontend/src/components/FileUpload.js` líneas 66-71 solo usa `data.draftKey` y `data.emptyFields[].rowIndex`; `FileUpload.test.js` solo siembra `{ emptyFields:[{rowIndex:3}], draftKey }`; ningún otro archivo de `src/` ni `sigmetum-infra` usa `processedData`, `rowData` ni `actionRequired`.

## Decisiones (alternativas descartadas)

- Quitar `rowData` en la ruta con `emptyFields.map(({ rowIndex }) => ({ rowIndex }))` y dejar `convertExcelToJson` intacto (evita tocar `functions/` y sus tests). Descartado quitar `rowData` en `convertExcelToJson` (cambio más amplio, sin necesidad; `rowData` se sigue generando, limpieza opcional fuera de alcance).
- Sin función auxiliar ni helper nuevo: es una línea.
- `actionRequired` se mantiene dentro de `data`, con el mismo texto y posición (moverlo sería un cambio de contrato). Si la decisión 1 de la spec lo dibuja fuera de `data`, es un error de redacción de la spec que corrige el tester.

## Fase 1

1. **Test que falla primero (TDD).**
   - Archivo: `tests/upload-excel.test.js` (añadir un test; no tocar los existentes).
   - Un `test('borrador: cuerpo completo del 400 sin processedData ni rowData', ...)` (fuera de bucle) que sube un Excel con filas de datos en las que la fila 3 y la fila 5 tienen una celda vacía y la 4 está completa (la cabecera es la fila 1 y el primer dato la 2; `tests/helpers/excel.js`: `fullRow`), y comprueba con `deepEqual` la forma COMPLETA: `{ success:false, error:'Some rows have empty fields.', data:{ emptyFields:[{ rowIndex:3 }, { rowIndex:5 }], draftKey:<valor>, actionRequired:'Confirm whether to continue or cancel the upload.' } }`. `draftKey` lleva la fecha de hoy y no entra literal: se extrae con `const { draftKey, ...resto } = r.json.data`, se comprueba con `assert.match(draftKey, /^data\/Málaga\/\d{4}-\d{2}-\d{2}_v\d+\.xlsx$/)` y se hace `deepEqual` con `data` reconstruido con ese `draftKey`. Además `assert.deepEqual(Object.keys(r.json).sort(), ['data','error','success'])`, `assert.equal('processedData' in r.json.data, false)` y que ningún elemento de `emptyFields` tenga `rowData`, para que el motivo del fallo sea explícito. Ojo: exceljs omite las filas totalmente vacías; las filas con una celda vacía sí llegan a `eachRow`. Mismo `argsLog.upload.length === 1`.
   - Comprobación: `node --test tests/upload-excel.test.js` debe FALLAR antes del paso 2 por sobrar `processedData` y `rowData` (no por sintaxis ni por un `rowIndex` mal calculado; el developer lo explica con la salida real).
2. **Cambio mínimo en la ruta.**
   - Archivo: `routes/data.js` (400 de borrador): en `data`, sustituir `emptyFields,` por `emptyFields: emptyFields.map(({ rowIndex }) => ({ rowIndex })),` y eliminar la línea `processedData,`. Dejar `draftKey` y `actionRequired` (mismo texto y posición) y el resto de la ruta intacto (400 de validación, `uploadFileToS3`, 200, `/upload/confirm`). No hay ruta nueva: no se toca `tests/estructura-rutas.test.js`.
   - Comprobación: el test del paso 1 pasa; los casos existentes de `tests/upload-excel.test.js` (`borrador ...`, `éxito ...`, `400 ...`) siguen pasando SIN modificarse; `tests/convertExcelToJson.test.js` y `tests/claves-cliente.test.js` pasan sin cambios.
3. **Subir `MIN_TESTS`.**
   - Archivo: `scripts/quality-check.mjs` (`MIN_TESTS`): al total EXACTO que reporte `npm test` (864 si el paso 1 añade un único `test()` fuera de bucle; si añade más, 863 más los añadidos). `--max-warnings` (hoy 4) no se toca salvo que baje el número real de avisos.
   - Comprobación: `npm test`, `npm run lint` y `npm run quality` pasan.

## A cargo del tester-documentador

- `docs/04-api.md`: el JSON del 400 pasa a `"emptyFields": [ { "rowIndex": 7 } ]`, sin `processedData`, con `draftKey` y `actionRequired` dentro de `data`; una frase que indique que ya no se devuelven `processedData` ni `rowData` (desde el 29/10/2026, D8).
- `docs/05-modulos.md`: fila de `POST /upload` (cuerpo ligero del 400); matizar la nota de `convertExcelToJson`: sigue construyendo `{ rowIndex, rowData }` y `processedData`, pero la ruta solo expone `rowIndex` en el 400.
- `docs/integracion/para-frontend.md`: F2 resuelto en el backend (29/10/2026); fila de `POST /upload` sin «aunque el 400 incluye más de lo que se necesita»; tabla de coordinación (`frontend:D8`) cerrada del lado backend; aviso de que `sigmetum-frontend/docs/integracion/para-backend.md` (sección 6, D8, y la fila de rutas) debe actualizarse en su repositorio (este repo no lo edita). Cambio compatible, sin `/api/v2`.
- `docs/07-estado-y-deuda-tecnica.md`: fecha «actualizado» 29/10/2026; D8 (tabla de discrepancias) y prioridades como resuelto (parte backend), con el hash tras el commit; métricas con `npm run docs:check -- --metrics`.
- **Corregir en la spec** `docs/specs/2026-10-29-d8-upload-respuesta-ligera-design.md` el esquema de la decisión 1: `actionRequired` va DENTRO de `data` (la nota, la decisión 5 y «fuera de alcance» ya lo dicen), y en la sección de pruebas citar el `deepEqual` completo.
- `docs/guias/mantenimiento.md` sección 6: revisar y decir en el resumen que el cambio toca el contrato (fila de `emptyFields`/`draftKey`). `docs/06-almacenamiento-s3.md` («respuesta 400 con draftKey»): solo revisar. Aviso para PR `docs/specs/2026-10-29-d8-upload-respuesta-ligera-aviso-pr.md`: cambio de forma del 400 compatible, a comunicar a los responsables del frontend para que actualicen su documento; infra sin impacto. Cierre: `npm run docs:check` y `npm run docs:gate`; `agentes:test` no aplica.

## Pruebas

- Nueva: el test de forma completa del 400 de borrador en `tests/upload-excel.test.js` (falla antes del paso 2, pasa después). Existentes sin modificar: `borradores`, `éxito ...`, `400 ...`, `tests/convertExcelToJson.test.js`, `tests/claves-cliente.test.js`, `tests/rutas-protegidas.test.js`.
- Comandos: `node --test tests/upload-excel.test.js` (rojo, luego verde), después `npm test`, `npm run lint`, `npm run quality`, `npm run docs:check`; antes del commit `npm run docs:gate`.

## Por confirmar

Que ningún consumidor fuera de este repo y del frontend revisado use `processedData` o `rowData`; el número final de `MIN_TESTS`.
