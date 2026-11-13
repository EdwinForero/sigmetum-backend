# Aviso para PR: `GET /get-data` abre las versiones `.xlsx` con token (D1, fase B1)

Fecha: 2026-11-12 · Spec y plan (en el repositorio del frontend, que lleva el ciclo): `sigmetum-frontend/docs/specs/2026-11/2026-11-12-revision-entorno-pruebas-design.md` y `...-plan.md` (fase B1 y «Anexo de la puerta 2»)

## Qué cambia

1. **`GET /get-data/:path(*)` con una clave de versión `.xlsx` exige token.** Nueva puerta local `tokenAuthIfVersionKey` en `routes/data.js`, primer manejador de la propia ruta (sin `router.use`): llama a `tokenAuth` solo si `isValidDataKey(req.params.path)`; decide sobre el mismo `req.params.path` ya decodificado que el manejador, así que `%2F` no la salta. Sin token válido: `401` (`No token provided`, `Invalid token`, `Token expired`) y `503` si no hay JWKS.
2. **La versión se convierte y se devuelve**: `getBufferFromS3` y `convertExcelToJson`, `200` `{ success: true, data: <filas> }` (mismo formato que el JSON activo). Si el objeto no es un libro legible, `422` `The stored file is not a readable Excel workbook` (la causa entra en el mensaje del error para el log). `NoSuchKey` y `AccessDenied` siguen en `404`.
3. **No cambia**: el activo `data/active/<provincia>.json` sigue público y con `getFileFromS3`; una clave no permitida sin token sigue en `400 Invalid path` (la puerta no actúa y la regla la rechaza antes de tocar S3).
4. `tests/estructura-rutas.test.js` gana un tercer tipo de ruta, `version-token`; `rutas-protegidas` lo comprueba fuera de `PROTECTED` (sigue con las doce rutas); `scripts/quality-check.mjs`: `MIN_TESTS` 1792.
5. **`Cache-Control: no-store`** en el `200` de la versión `.xlsx` autenticada (los datos van tras token y no deben cachearse); el activo `.json` público no cambia. El frontend no necesita nada.

Cambio **compatible condicionado al orden de despliegue**, sin `/api/v2`, sin variables de entorno, permisos IAM ni dependencias nuevas. En `docs/04-api.md` la fila sigue con 🔓 porque `docs-check` lee el primer manejador de forma estática.

## Antes de desplegar (requisito)

1. **Orden: primero este backend, después el frontend** (otra PR, fase F0: `FileDropdown` con `api.getAuth`).
2. Un frontend viejo contra este backend recibe `401` en vez de `500` (mismo aviso de error); un frontend nuevo contra un backend viejo sigue recibiendo `500`.

## Decisiones y riesgos aceptados

- **Antes siempre daba `500`**: la versión `.xlsx` llegaba a `JSON.parse` de un binario, así que nadie la usaba con éxito; no se rompe ningún uso real.
- **M9**: la ruta convierte un Excel dentro de la petición, sin tope previo de tamaño. Descartado `buffer.length > MAX_UPLOAD_BYTES`: con token queda tan expuesta como `/upload` (cuyo M9 se acepta) y las versiones anteriores a M6 de más de 10 MB dejarían de abrirse **(por confirmar si existen)**. No necesita limitador porque exige token.
- **M2 en parte**: el activo sigue público y sin límite, a propósito (lo lee la web pública).
- **C16** (cualquier usuario del pool es administrador) sigue: cualquier token válido abre cualquier versión.

## Integración

Integración: contrato modificado con el frontend (F1 y líneas de la tabla de endpoints y de consumo en `docs/integracion/para-frontend.md`): las versiones `.xlsx` exigen token y devuelven `200` / `401` / `422`; nadie las usaba con éxito porque siempre daban `500`; `frontend:D1` queda resuelta en la misma ruta. Se despliega antes que el frontend. Infraestructura: sin cambios (`docs/integracion/para-infra.md`, nota de D1).

## Para quien revisa

- Código: solo `routes/data.js` (`tokenAuthIfVersionKey` y la rama `.xlsx` de `GET /get-data`) y `scripts/quality-check.mjs` (`MIN_TESTS`).
- Pruebas: ampliados `flujo-datos-s3`, `s3-robustez`, `claves-cliente`, `rutas-protegidas` y `estructura-rutas`.
- Medición tras desplegar **(por confirmar)**: Jaén V1 sin token da `401` (`curl`); con token, desde `/manage-data` con el frontend de F0, V1, V2 y Málaga con la clave codificada dan `200`.
- Cierre: `node --test --test-concurrency=2 "tests/**/*.test.js"` (Node 24 y Node 22), `npm run lint`, `npm run quality`, `npm run docs:check` y `npm run docs:gate`.
