# S15 y M25: AccessDenied en el glosario y clave de GET /get-data: spec

Fecha: 2026-10-30 · Estado: cerrado

## Objetivo

`sigmetum-infra` va a acotar `s3:ListBucket` por `Prefix` (`gallery/*` y `data/*`, infra:S7). Con esa política S3 probablemente responderá `403 AccessDenied` (no `404 NoSuchKey`) ante una clave inexistente **(por confirmar en dev)**. Hoy `getTextJsonS3` solo devuelve `[]` con `NoSuchKey` y `errorHandler` responde `500 Access denied to storage` con `AccessDenied`, así que, sin glosario creado, `GET /list-terms` rompería tras el `apply` (infra:S15, bloquea el apply). Además, `GET /get-data/:path(*)` pasa la clave a S3 sin validarla (M25: `..%2f..%2fsecret` da 500). El backend se despliega **antes** del apply de infra.

## Decisiones del usuario (30/10/2026)

1. **Glosario, opción A:** `AccessDenied` al leer el glosario se trata como `[]` **solo en `GET /list-terms`** (`200` `data: []`). `POST /upload-term` y `DELETE /delete-term` siguen propagando el error (`500` `Access denied to storage`): un permiso roto nunca sobrescribe el glosario (riesgo A6). La opción D (comprobar existencia por otra vía) queda como mejora futura y no se implementa; B y C descartadas.
2. **`GET /get-data/:path(*)`, lista de permitidos acotada:** versiones `.xlsx` (regla de `isValidDataKey`) y activos `data/active/<provincia>.json` (segunda lista de permitidos, solo para esta ruta, con la provincia validada por `getProvinciaNameError` y en NFC). Todo lo demás (traversal, otras raíces, `data/terms`, `data/drafts`, malformadas) responde `400` controlado sin llamar a S3.
3. **Clave permitida pero inexistente con `AccessDenied`:** `404` en `get-data` (ruta de solo lectura; coherente con el `404` de `NoSuchKey`, B9).
4. **Compatibilidad:** sin otros consumidores conocidos; cambio compatible, sin `/api/v2`, con aviso en la PR.

## Comportamiento actual (comprobado en el código)

- `GET /list-terms` lee `data/terms/noLatinTerms.json` con `getTextJsonS3`: `[]` solo con `NoSuchKey`; `AccessDenied` da 500.
- `POST /upload-term` (`uploadTextToJsonS3`) y `DELETE /delete-term` (`deleteTermFromS3`) leen el glosario con la misma función y lo reescriben entero.
- `GET /get-data/:path(*)` es público, sin validación; `getFileFromS3` hace `JSON.parse` del objeto. Un `.xlsx` da 500 (`SyntaxError`, frontend:D1).
- El único uso del frontend (`src/components/FileDropdown.js`) llama `GET /get-data/${fileKey}` con claves de `GET /list-files` (`data/<provincia>/<nombre>`). No se ha encontrado en `src/` ninguna llamada con `data/active/...`.
- `isValidDataKey` solo acepta `data/<provincia>/AAAA-MM-DD_vN.xlsx` y rechaza `data/active/<provincia>.json`.

## Criterios de aceptación

### De código

1. `GET /list-terms` con el glosario inexistente responde `200` `data: []` si S3 devuelve `NoSuchKey` o `AccessDenied`; con cualquier otro error (red, 5xx, JSON corrupto, cuerpo vacío, no-array) propaga el error. Prueba en `tests/s3-robustez.test.js` con el SDK simulado.
2. `POST /upload-term` y `DELETE /delete-term` con `AccessDenied` en la lectura responden `500` `Access denied to storage` y **no llaman a `putObject`** (test que lo demuestre). `NoSuchKey` mantiene su comportamiento actual (el alta crea el glosario).
3. `GET /get-data/<clave>` con una clave fuera de la lista de permitidos (`..%2f..%2fsecret`, `data/../x`, `data/terms/...`, `data/drafts/...`, otras raíces, vacía, demasiado larga, provincia inválida o no NFC) responde `400` `{ success: false, error }` sin llamar a S3. Prueba en `tests/claves-cliente.test.js`.
4. `GET /get-data/data/active/<provincia>.json` (provincia válida) conserva su respuesta actual: `200` con los datos y `404` si no existe. Test de regresión: los activos que hoy funcionan siguen funcionando.
5. `GET /get-data/<clave permitida inexistente>` responde `404` con texto fijo tanto con `NoSuchKey` como con `AccessDenied`; otros errores de S3 siguen como hoy.
6. Límite explícito (no se arregla aquí): `GET /get-data/data/<provincia>/AAAA-MM-DD_vN.xlsx` sigue dando 500 por `JSON.parse` hasta resolver frontend:D1. Test o nota que lo deje constatado.
7. Ninguna clave que hoy responda `200` pasa a `400` (a verificar con los activos y con el listado del frontend).
8. `npm run lint`, `npm run quality`, `npm run docs:check`, `npm test` y `npm run docs:gate` pasan; si se añaden tests se sube `MIN_TESTS` en `scripts/quality-check.mjs`.

### De documentación

1. `docs/integracion/para-infra.md`: `ALLOWED_ORIGIN` admite una **lista separada por comas** (`app.js:30` divide por `,`, recorta espacios y compara de forma exacta); corregir la fila que dice "Un único origen exacto" y la sección 5 si lo repite. Igual en `docs/03-configuracion.md` (hoy en singular).
2. `docs/integracion/para-infra.md`: estado resultante de infra:S15 (resuelto en el backend para `list-terms`, no para las altas); mitigación temporal: subir `[]` a `data/terms/noLatinTerms.json` en dev y prod antes del apply, **obligatoria para poder dar de alta el primer término** (el primer alta falla con 500 hasta entonces); la mitigación **no es necesaria para `get-data`**, que ahora da 404 con `AccessDenied`. Sustituir las notas "(por confirmar) `s3:ListBucket`" de A6, A2/A9 y B5/B9 por el estado nuevo; orden: backend antes del apply.
3. `docs/04-api.md`, `docs/05-modulos.md`, `docs/06-almacenamiento-s3.md` y `docs/guias/buenas-practicas-backend.md` (fila "Distingue no existe de falló"): reflejar que la lectura de `list-terms` trata `AccessDenied` como vacío y las escrituras no, y la lista de permitidos de `get-data`.
4. `docs/07-estado-y-deuda-tecnica.md`: M25 resuelto; S15 anotado; M2 sigue abierto (primer paso); A6 con el riesgo residual; riesgo nuevo anotado (ver abajo); métricas y fecha.
5. `docs/integracion/para-frontend.md`: filas de `GET /get-data` y `GET /list-terms` y F1 con el comportamiento nuevo; cambio compatible.
6. Aviso para PR (`docs/specs/*-aviso-pr.md`): claves malformadas de 500 a 400; despliegue del backend antes del apply de infra; mitigación temporal.

## Riesgos aceptados

- `list-terms` con un permiso roto en un glosario existente devuelve `[]` en lugar de error: oculta el fallo, pero no destruye datos.
- `get-data` con `AccessDenied` devuelve 404: puede ocultar un permiso roto como "no existe".
- Sin la mitigación, el primer alta de término falla con 500 tras el apply.

## Fuera de alcance

- Cerrar M2 (restringir `GET /get-data` por completo o exigir token) y resolver D1 (convertir un `.xlsx` de versión en registros).
- La opción D (comprobar existencia por otra vía) para las escrituras.
- Editar `sigmetum-infra` o `sigmetum-frontend`; el backend solo documenta y avisa en la PR.
- Subir el `[]` al bucket (acción manual de operaciones).
- B12 y el resto de hallazgos de la prueba en preprod.

## Impacto en contratos externos

- `docs/integracion/para-frontend.md`: afecta a `GET /get-data` (claves malformadas de 500 a 400; inexistentes con `AccessDenied` a 404) y a `GET /list-terms` (`200 []` con `AccessDenied`). Compatible, sin `/api/v2`: ninguna clave que hoy funcione pasa a 400. Los `.xlsx` siguen en 500 (F1/D1). Aviso en la PR.
- `docs/integracion/para-infra.md`: afecta solo en documentación. Sin variables ni permisos nuevos; orden backend antes del apply; mitigación temporal; corrección de `ALLOWED_ORIGIN` (lista por comas). Permisos necesarios: `GetObject`, `PutObject`, `DeleteObject` y `ListBucket` con `Prefix` en `gallery/` y `data/` (por confirmar que todos los listados llevan `Prefix` en ese ámbito).

## Preguntas abiertas

Sin preguntas abiertas de backend. Queda una acción de infra/usuario (no bloquea el código): decidir quién sube `[]` a `data/terms/noLatinTerms.json` en dev y prod antes del apply, y confirmar en dev qué código devuelve S3 con la política nueva para una clave inexistente (`NoSuchKey` o `AccessDenied`) **(por confirmar)**.
