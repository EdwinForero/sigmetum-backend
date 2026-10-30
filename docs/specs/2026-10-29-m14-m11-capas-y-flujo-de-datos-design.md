# M14 y M11 (parcial): capas separadas y flujo de datos con S3 simulado con estado: spec

Fecha: 2026-10-29 · Estado: cerrado

## Objetivo

Hoy `aws/awsS3connect.js` decide qué versión queda activa (`deleteFileFromS3`, `updateFileS3`) y reconvierte el Excel con `convertExcelToJson`, y `functions/getNextVersion.js` depende de S3 (M14). Como consecuencia, la regla de versionado solo se prueba con espías a nivel de ruta, no de extremo a extremo (M11 parcial). Esta spec pide dos cosas ligadas: que `aws/` quede solo con leer, escribir, listar, borrar y firmar (la regla de la versión activa vive en `functions/` como funciones puras que reciben datos, y `getNextVersion` recibe el listado en lugar de leer S3), y que exista un test del flujo upload → confirm → update-file → delete-file contra un S3 simulado con estado. Es un refactor: el comportamiento observable de la API no cambia.

## Criterios de aceptación

### De código

1. Comportamiento intacto: todos los tests existentes siguen en verde. Solo se permite adaptar `tests/helpers/simulados.js` y los tests que dependan de las firmas cambiadas (`getNextVersion`, `deleteFileFromS3`, `updateFileS3`). Cada archivo y test adaptado se enumera en la spec o en el plan del architect y no pierde ninguna aserción.
2. Caracterización previa: antes del refactor existen tests nuevos que fijan, contra el `aws/awsS3connect.js` real con S3 simulado, el efecto observable de los casos actuales. Pasan antes y después del cambio. Casos mínimos:
   - borrar la última versión: el activo se regenera desde la anterior;
   - borrar una versión antigua: el activo se regenera con el mismo contenido que la última;
   - borrar la única versión: se borra el activo;
   - borrar con restos `.xlsx` de nombre no estándar y ninguna versión estándar: el activo no se toca;
   - `_v10` frente a `_v9` (A8);
   - `updateFileS3` escribe el activo con `JSON.stringify(processedData, null, 2)`, `ContentType: application/json` y la clave `<ACTIVE_PATH>/<provincia>.json`;
   - `getNextVersion` con varias versiones del mismo día y de otros días.
   Si un test de caracterización revela una diferencia observable respecto de lo que se esperaba, el refactor se detiene y la diferencia se devuelve como pregunta al usuario; no se corrige en silencio.
3. Funciones puras nuevas: la regla de la versión activa (elegir la versión que queda activa a partir de un listado y decidir si el activo se escribe, no se toca o se borra) existe en `functions/` como funciones que reciben datos y no importan `aws/`. Tests que fallan mientras no existan: cubren los casos del punto 2 con listados en memoria, sin S3 ni red.
4. `getNextVersion` deja de importar `aws/`: recibe el listado de archivos. Un test lo comprueba con un listado en memoria (falla antes del cambio, porque hoy llama a S3).
5. Separación de capas comprobada con un test sobre las importaciones, sin tocar `scripts/`. Falla si `aws/awsS3connect.js` importa de `functions/` algo fuera de la lista permitida, o si algún archivo de `functions/` importa `aws/`. La lista permitida la fija el `architect` (hoy `aws/` importa `convertExcelToJson` y `versionName`; tras el refactor debe decidirse qué sigue permitido, con la intención de que `aws/` no contenga la regla de versión).
6. S3 simulado con estado (M11): un módulo en `tests/helpers/` sobre `S3Client.prototype.send`, usado con el `aws/awsS3connect.js` real y la app real (mismo patrón que `tests/s3-robustez.test.js`; reutiliza su código si es razonable y sin romper ese test). Implementa en memoria GetObject, PutObject, DeleteObject y ListObjectsV2 (con paginación). Cubre `data/` y el activo (`ACTIVE_PATH`, que el usuario describe como `data/active/{provincia}.json`: por confirmar contra `config/s3Paths.js`). Un test de extremo a extremo (HTTP con supertest) cubre:
   - upload sin celdas vacías: se guarda el Excel y el activo, y `/get-data` devuelve los datos;
   - upload con celdas vacías: 400 con `draftKey`, el Excel queda como borrador y el activo no cambia;
   - confirm con `confirmed: true`: el activo se regenera desde el borrador;
   - cancel (confirm sin confirmar): el borrador se borra y el activo no cambia;
   - update-file: el activo pasa a la versión elegida;
   - delete-file de la última versión y de una antigua;
   - segunda subida con varias versiones existentes: `getNextVersion` devuelve el siguiente número.
7. Evidencia de que el test de extremo a extremo detecta fallos: el tester deja constancia de que falla si se rompe a propósito la regla de la versión activa (por ejemplo, orden por texto en lugar de numérico).
8. Mismas rutas, mismas respuestas (`{ success, data|error }` y textos), mismos códigos de estado, mismas claves de S3 (`config/s3Paths.js`) y mismo formato del activo (JSON con sangría de 2 espacios).
9. `npm test`, `npm run lint`, `npm run quality` y `npm run docs:check` pasan; `MIN_TESTS` en `scripts/quality-check.mjs` sube al número real de tests; no se añaden rutas.

### De documentación

1. `docs/07-estado-y-deuda-tecnica.md`: M14 pasa a resuelto con fecha y commit; M11 sigue "Parcial" con lo que falta enumerado (resto de módulos sin tests, tests de contrato que recomienda el frontend y lo que quede fuera del doble con estado: fallos inyectados, imágenes, glosario, URLs firmadas, concurrencia); se actualiza el paso 7 del orden recomendado, la fecha "actualizado" y la tabla de métricas (tests, archivos de test).
2. `docs/05-modulos.md`: describe las responsabilidades nuevas de `aws/` y `functions/` y la dirección de dependencias (`functions/` no importa `aws/`).
3. `docs/06-almacenamiento-s3.md`: el ciclo de vida de versiones y activo no cambia; solo se corrige dónde vive cada regla.
4. `docs/guias/buenas-practicas-backend.md` (sección 2, estructura): se contrasta con el resultado; si guía y código difieren, se dice.

## Fuera de alcance

- La lógica de `upload` de `routes/data.js`: se queda donde está.
- Una capa de servicio nueva (opción C).
- A2 (borradores en prefijo propio), M8, M9 (la reconversión del Excel sigue dentro de la petición), M23.
- Cualquier cambio observable de la API y del contrato con el frontend: rutas, formato de respuestas, columnas del Excel, nombres de versión, JWT, CORS.
- Del doble con estado: inyección de fallos (la cubre `tests/s3-robustez.test.js`), imágenes, glosario, URLs firmadas y concurrencia.
- Tests de contrato para el frontend y tests de módulos sin cobertura ajenos al flujo de datos (siguen en M11).
- Cambios en las demás funciones de `aws/` (imágenes, glosario, firmas), salvo lo que obligue el refactor.

## Impacto en contratos externos

- `docs/integracion/para-frontend.md`: no lo afecta, porque no hay cambio observable (criterio de código 8). `functions/getNextVersion.js` está en `areasContrato` de `.claude/flujo.json`: hay que revisar la sección 6 de `docs/guias/mantenimiento.md` y decirlo en el resumen final.
- `docs/integracion/para-infra.md`: no lo afecta (mismas variables de entorno y mismas operaciones de S3). El orden o el número de llamadas a S3 puede variar; hay que confirmar que eso no afecta a los permisos descritos en ese documento (por confirmar).

## Preguntas abiertas

Ninguna (0). Las cinco preguntas de la primera versión quedaron resueltas por el usuario y están incorporadas arriba. Queda delegada al `architect`, como parte de su plan y no como pregunta, la lista exacta de importaciones permitidas de `aws/` hacia `functions/` (criterio de código 5).
