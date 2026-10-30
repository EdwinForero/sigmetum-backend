# Borradores de POST /upload en un prefijo propio (A2 y A9): spec

Fecha: 2026-10-29 · Estado: cerrado

## Objetivo

Hoy un Excel con celdas vacías se guarda en `data/<provincia>/` antes de que nadie confirme, y desde ese momento cuenta como una versión más: aparece en `GET /list-files`, entra en el cálculo de la versión siguiente y puede acabar como JSON activo (A2). Además, cancelar un borrador (o borrar cualquier versión) regenera el activo desde la última versión estándar que queda, que puede ser otro borrador sin confirmar (A9). Un borrador sin confirmar no debe ser una versión ni afectar al JSON activo ni a las versiones reales hasta que se confirme.

## Decisiones tomadas (respuestas del usuario)

1. `draftKey` es una clave opaca: el frontend solo la recibe del 400 de `/upload` y la reenvía tal cual a `/upload/confirm` (comprobado en `FileUpload.js`: solo usa `data.draftKey` y `emptyFields[].rowIndex`). Cambia de forma al prefijo de borradores. Cambio compatible: sin `/api/v2`, con aviso al frontend.
2. `/update-file` y `/delete-file` rechazan claves de borrador (solo versiones confirmadas). `/upload/confirm` solo acepta borradores y rechaza versiones ya confirmadas.
3. El segmento del prefijo de borradores se reserva también en `RESERVED_SEGMENTS`, para que `GET /list-files` no lo agrupe como provincia.
4. No se migran los borradores existentes: los previos al despliegue quedan como versiones normales; el administrador revisa y borra a mano los que sobren. Se documenta en el aviso de PR. Sin periodo transitorio.
5. El número `vN` se calcula al confirmar, sobre las versiones reales (sin huecos ni repetidos).
6. Un nuevo `POST /upload` de la misma provincia descarta el borrador previo de esa provincia (un solo borrador pendiente por provincia). Sin endpoint de listado de borradores ni caducidad por ciclo de vida.
7. Confirmar usa solo las operaciones de S3 que ya existen: leer el borrador, escribir la versión, regenerar el activo y borrar el borrador al final. Si se interrumpe, queda el borrador y se puede repetir la confirmación. Sin operaciones de S3 nuevas ni permisos IAM nuevos más allá del prefijo (por confirmar contra `docs/integracion/para-infra.md`).
8. Cancelar = borrar el borrador sin tocar versiones ni activo. Esto resuelve A9 y la variante 1 solo en lo que respecta a cancelar borradores: borrar una versión real con `/delete-file` sigue regenerando el activo desde la última versión real que queda, y los borradores antiguos no migrados (decisión 4) seguirán contando como versiones hasta que el administrador los borre.

## Criterios de aceptación

### De código

1. Tras un `POST /upload` que responde 400 por celdas vacías, el Excel no aparece en `GET /list-files` ni en el listado de la carpeta `data/<provincia>/` (observable con el doble de S3 con estado de `tests/`). El segmento del prefijo de borradores no aparece como provincia en `/list-files`.
2. Con un borrador sin confirmar presente, `POST /delete-file` de una versión real regenera el activo solo desde versiones reales, y nunca desde el borrador.
3. `POST /upload/confirm` con `confirmed: false` borra solo el borrador: `data/active/<provincia>.json` y las versiones reales quedan idénticos (misma clave y contenido), sin escrituras sobre el activo.
4. `POST /upload/confirm` con `confirmed: true` guarda el Excel como versión definitiva en `data/<provincia>/` con nombre estándar (`AAAA-MM-DD_vN.xlsx`), con N calculado en ese momento sobre las versiones reales (siguiente número del día, sin repetir ni pisar ninguna existente), regenera el activo desde ella y, al final, borra el borrador.
5. Si la confirmación se interrumpe antes de borrar el borrador, el borrador sigue existiendo y repetir la confirmación termina bien (prueba con el doble de S3 que falla en un paso).
6. Un `POST /upload` que vuelve a dar 400 por celdas vacías para una provincia con un borrador previo deja un único borrador (el nuevo) para esa provincia; el anterior desaparece y el `draftKey` anterior deja de ser confirmable.
7. Un `POST /upload` sin celdas vacías sigue activando al instante y no deja borrador. Si existía un borrador previo de la provincia, queda definido (en el plan) qué ocurre con él; el criterio mínimo es que no queden dos borradores de una provincia.
8. Separación de claves: `/upload/confirm` rechaza con 400 una clave de versión real; `/update-file` y `/delete-file` rechazan con 400 una clave de borrador. Se prueba también con claves de borrador malformadas, de otra provincia, con `..`, con segmentos de más y con la provincia reservada. La validación sigue siendo lista de permitidos: ninguna clave de S3 se construye con texto del cliente sin validar.
9. Confirmar o cancelar un `draftKey` válido pero ya inexistente (descartado por una subida posterior o ya confirmado) responde con un error controlado vía `next(error)`, sin tocar versiones ni activo. El código y mensaje exactos quedan por confirmar en el plan.
10. Solo se usan las operaciones de S3 existentes en `aws/awsS3connect.js` (leer, escribir, listar, borrar); sin permisos IAM nuevos.
11. `npm test`, `npm run lint`, `npm run quality` y `npm run docs:check` pasan; `MIN_TESTS` en `scripts/quality-check.mjs` sube si se añaden tests.

### De documentación

1. `docs/06-almacenamiento-s3.md`: describe el prefijo de borradores, su ciclo de vida (creación, sustitución por una subida posterior, confirmación, cancelación) y el cálculo de `vN` al confirmar.
2. `docs/05-modulos.md`: refleja las funciones y constantes nuevas o cambiadas (`config/s3Paths.js`, incluido `RESERVED_SEGMENTS`; `functions/`; `aws/`).
3. `docs/04-api.md`: describe la nueva forma del `draftKey` del 400 de `/upload` y el comportamiento de `/upload/confirm`, `/update-file` y `/delete-file` ante cada tipo de clave.
4. `docs/integracion/para-frontend.md`: las filas de `/upload` y `/upload/confirm` de la tabla de compatibilidad (cambio compatible, `draftKey` opaco) y el aviso al frontend de que no debe interpretar el `draftKey`.
5. `docs/integracion/para-infra.md`: el prefijo nuevo en la lista de prefijos que usa el código, y la confirmación de que no hay acciones ni permisos de S3 nuevos (el prefijo cae bajo los permisos actuales del bucket).
6. `docs/guias/seguridad.md`: la fila de la clave de versión de datos y la de la clave de borrador, si el formato de clave que aceptan las rutas cambia.
7. `docs/07-estado-y-deuda-tecnica.md`: A2 y A9 pasan a resueltos con fecha y hash, métricas al día, fecha "actualizado" de hoy, y anotado que los borradores previos al despliegue siguen como versiones hasta que el administrador los borre.
8. Aviso de PR (`docs/specs/*-aviso-pr.md`): incluye que el administrador debe revisar y borrar a mano los borradores previos al despliegue, y el aviso al frontend.

## Fuera de alcance

- Migrar los borradores existentes y cualquier periodo transitorio que acepte el `draftKey` antiguo.
- Endpoint para listar borradores, caducidad por antigüedad o reglas de ciclo de vida en el bucket.
- Condiciones de carrera entre dos administradores (M1), incluida la reserva atómica del número de versión.
- Restringir `GET /get-data/:path(*)` (M2) y el sustituto para abrir un Excel de versión (D1/F1).
- Cambiar el formato del nombre de versión (`AAAA-MM-DD_vN.xlsx`), las columnas del Excel o el formato de `emptyFields`.
- Cambios en el frontend o en `sigmetum-infra`: solo se documentan y se avisan en la PR.

## Impacto en contratos externos

- `docs/integracion/para-frontend.md`: lo afecta, de forma compatible. El `draftKey` del 400 de `POST /upload` cambia de forma (pasa al prefijo de borradores) pero el frontend lo trata como opaco, así que no hace falta `/api/v2`. Cambia también que `GET /list-files` deja de mostrar borradores, que la `key` de la versión definitiva se calcula al confirmar (la confirmación no devuelve hoy la `key`) y que `/upload/confirm` rechaza claves de versiones reales. Hay que avisar al frontend en la PR.
- `docs/integracion/para-infra.md`: lo afecta solo en la lista de prefijos. Sin variables de entorno nuevas, sin acciones de S3 nuevas y sin cambio en la política IAM de `modules/storage/main.tf` (`GetObject`, `PutObject`, `DeleteObject`, `ListBucket`) **(por confirmar contra el documento)**.

## Preguntas abiertas

Ninguna.
