# Aviso para PR: robustez de S3 (A5/D5, A6, A8, M7, M10), 29/10/2026

Spec: [2026-10-28-s3-robustez-a5-a6-a8-m7-m10-design.md](2026-10-28-s3-robustez-a5-a6-a8-m7-m10-design.md) · Plan: [2026-10-28-s3-robustez-a5-a6-a8-m7-m10-plan.md](2026-10-28-s3-robustez-a5-a6-a8-m7-m10-plan.md). Se tocan áreas de contrato (`config/s3Paths.js`, `functions/getNextVersion.js`) sin cambiar rutas, envoltorio `{ success, data | error }`, claves de S3, formato `AAAA-MM-DD_vN.xlsx`, columnas del Excel, JWT ni CORS.

Integración: documento afectado, [para-frontend](../integracion/para-frontend.md) (F3 resuelto en el backend, F9 nuevo, tabla de campos y sección 4). [para-infra](../integracion/para-infra.md): sin cambios de variables de entorno, permisos ni endpoints; solo se anota el riesgo de `s3:ListBucket` en el perfil SSO local.

## Qué cambia (contrato)

- **A6, único cambio observable que requiere aviso**: `GET /list-terms` pasa de `200` `[]` a `500` genérico (por `next(error)`, sin el texto interno) ante cualquier fallo de S3 distinto de `NoSuchKey` (permisos, red, 5xx), o si el glosario tiene 0 bytes, JSON corrupto o un JSON que no es un array. `POST /upload-term` y `DELETE /delete-term` responden `500` y ya **no sobrescriben el glosario** (antes partían de `[]` y lo dejaban con un solo término o vacío). `NoSuchKey` sigue dando `200` `[]` y el primer término sigue creando el glosario. Matiz de mensajes: con `AccessDenied`, `list-terms` y `upload-term` responden `Access denied to storage` y `delete-term` `Internal server error`.
- **Efecto de A6 a vigilar**: un glosario de 0 bytes, corrupto o no-array ya no se autocura al añadir un término; bloquea `list-terms`, `upload-term` y `delete-term` con `500` hasta repararlo a mano en S3.
- **A5/D5**: `GET /list-images` con la galería vacía o con solo el marcador de carpeta `gallery/` pasa de `500` (o del marcador como imagen de `fileName` vacío) a `200` `data: []`. Compatible; el formato `{ fileName, url }` no cambia.
- **M10**: `GET /list-files`, `GET /get-merged-data`, `getNextVersion` y `deleteFileFromS3` ven todos los objetos (paginación completa, sin tope, con guardia contra token repetido o ausente); dejan de truncarse en silencio por encima de 1000. Más datos, mismo formato.
- **M7**: `GET /get-merged-data` lee los activos en paralelo, con el mismo contenido y el mismo orden.
- **A8**: `deleteFileFromS3` regenera el activo desde la versión más reciente por fecha y `N` entero (`_v10` frente a `_v9`); si solo quedan `.xlsx` de nombre no estándar no toca el activo, y si no queda ningún `.xlsx` lo borra.
- Código: `aws/awsS3connect.js`, `config/s3Paths.js` (`DATA_FILE_NAME_PATTERN` con dos grupos de captura, fuente única), `functions/versionName.js` (nuevo) y `functions/getNextVersion.js`; `scripts/quality-check.mjs` (suelo de tests) y `package.json` (`--max-warnings` de 5 a 4). Sin dependencias nuevas.

## Frontend

Clasificación: **compatible, por confirmar** (sin `/api/v2`): no cambia el envoltorio ni los campos. A6 es el único cambio observable y por eso va en el aviso. **(por confirmar)** contra el código del frontend: que muestre bien un `500` al cargar el glosario y que no dependa del elemento de clave vacía del marcador de la galería.

## Infraestructura

Sin cambios en `sigmetum-infra`. La paginación usa `s3:ListBucket`, ya concedido al rol de Beanstalk (política `beanstalk_s3`). **Riesgo (por confirmar)**: sin `s3:ListBucket`, S3 responde `AccessDenied` y no `NoSuchKey` cuando falta el glosario, y `GET /list-terms` daría `500` en local; que el perfil SSO local lo tenga no se ha comprobado.

## Pendiente

- Todo se verificó con `S3Client.prototype.send` parcheado; el camino con S3 real queda **(por confirmar)**.
- Siguen abiertos B5 y M14 (`deleteFileFromS3` aún decide en `aws/`, ahora con una función pura de `functions/`), M8 y A2.
- Siguen pendientes las condiciones previas de despliegue de las entregas 2 y 3 de M21 ([aviso](2026-10-28-m21-entrega2-aviso-pr.md)); esta iteración no las cierra.
