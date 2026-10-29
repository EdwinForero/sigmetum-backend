# A1 y A4: fecha única en el versionado, provincia y claves de versión validadas: spec

Fecha: 2026-10-28 · Estado: cerrado

## Objetivo

A1: el cálculo de la versión siguiente y el nombre del archivo deben usar la misma fecha de "hoy", en UTC; hoy usan zonas horarias distintas y, cerca de medianoche, una subida puede obtener `v1` aunque ya exista un `v1` con la fecha del nombre y sobrescribirlo.
A4: la provincia que se lee de la primera fila del Excel se usa tal cual como carpeta de S3; debe comprobarse antes de construir ninguna clave, para que ningún valor del Excel pueda escribir fuera de `data/{provincia}/`, colisionar con carpetas reservadas ni romper `GET /list-files` y `GET /get-merged-data`.
Alcance ampliado (decisión del usuario): los listados por prefijo no deben mezclar carpetas que comparten el principio del nombre, y las claves que el cliente manda a `POST /upload/confirm`, `POST /update-file` y `POST /delete-file` se validan con la misma regla (cierra la parte de M4 que afecta a esas rutas).

## Criterios de aceptación

### De código

Fecha (A1)

1. `getNextVersion` y `formatFileName` obtienen el día de "hoy" en UTC. La fecha debe poder fijarse desde fuera para probarla (sin depender del reloj ni del huso del host).
2. Con la fecha fijada en un instante en que el día UTC y el día local difieren, la versión calculada y la fecha del nombre generado corresponden al mismo día UTC; si ya existe `vN` de ese día, la subida produce `vN+1` y no sobrescribe. (Observación: prueba con fecha controlada; no hay base de tests, M11.)
3. El formato del nombre sigue siendo `AAAA-MM-DD_vN.xlsx`, sin cambios.

Provincia en `POST /upload` (A4)

4. La provincia del Excel se recorta (trim de espacios en los extremos) y se normaliza a NFC antes de validar; el valor recortado y normalizado es el que se usa en la clave de S3, en `data/active/{provincia}.json` y en la comparación entre filas. No se cambian mayúsculas ni acentos más allá de NFC (`Málaga` y `Malaga` siguen siendo carpetas distintas).
5. Una provincia es válida si, tras ese paso, cumple una regla de formato: solo letras (con acentos), espacios y guiones, con una longitud máxima (el valor concreto lo fija el plan) y sin `/`, `\`, `..`, dígitos ni otros caracteres. La barra se sigue rechazando.
6. `POST /upload` responde 400 con `{ success: false, error }` y mensaje fijo, sin escribir nada en S3, si la provincia: es una reservada exacta (`active`, `terms`, `drafts` y los valores de `RESERVED_SEGMENTS`); empieza, en minúsculas, por `active` o `terms` (por ejemplo `Activos`, `Terms2`); es `__proto__`, `constructor`, `prototype` u otro nombre de propiedad de objeto; no es una cadena; o está ausente o vacía tras recortar (deja de existir el valor `Desconocido`).
7. `POST /upload` con un Excel cuyas filas contienen más de una provincia distinta (tras recortar y NFC, comparación exacta) responde 400 y no escribe en S3. Filas con provincia vacía en un Excel con otras provincias: criterio exacto por confirmar en el plan.
8. Una provincia válida sigue subiéndose, versionándose y activándose como hoy; las claves existentes y la respuesta de `GET /list-files` no cambian. `GET /list-files` no falla por ningún valor aceptado.

Prefijos de listado

9. Listar la carpeta de una provincia usa el prefijo con barra final: con `data/Santa Cruz` y `data/Santa Cruz de Tenerife` presentes, `getNextVersion` y el listado que hace `deleteFileFromS3` de `Santa Cruz` solo ven los archivos de `Santa Cruz`. El cambio en `aws/` se limita al prefijo del listado, sin lógica de negocio nueva.
10. `getMergedDataInS3Folder('data/active')` no recoge objetos de `data/activos/...` ni de otras carpetas con el mismo principio de nombre.

Claves del cliente (parte de M4)

11. `POST /upload/confirm` (`draftKey`), `POST /update-file` y `POST /delete-file` (`fileName`) validan la clave antes de usarla: prefijo `data/`, exactamente tres segmentos, segmento de provincia con la regla de los criterios 5 y 6, y nombre de archivo `AAAA-MM-DD_vN.xlsx`. Los borradores se nombran igual que las versiones (`data/{provincia}/AAAA-MM-DD_vN.xlsx`, confirmado en `routes/data.js`), así que `draftKey` usa la misma regla. Una clave que no cumple responde 400 con mensaje fijo y no toca S3.
12. En esas tres rutas la clave del cliente nunca se normaliza ni se reescribe: si el segmento de provincia no está en NFC, se rechaza con 400 (decisión del usuario). El recorte y la normalización NFC del criterio 4 solo se aplican al valor leído del Excel.
13. Lo que no cubre: que el objeto exista, la sobrescritura por carreras (M1), `GET /get-data/:path(*)` (M2), las claves de imágenes y términos (M5) ni la validación de tamaño (M6). M4 queda abierto salvo para estas tres rutas.

Verificación

14. `npm run lint`, `npm run quality`, `npm run docs:check` y `npm run docs:gate` pasan; el camino con S3 real y el contraste con las carpetas y claves reales del bucket (dev y prod), incluidas posibles carpetas en NFD, quedan **(por confirmar)**.

### De documentación

1. `docs/07-estado-y-deuda-tecnica.md`: A1 y A4 resueltos con fecha de hoy; M4 actualizado (cerrado para `upload/confirm`, `update-file` y `delete-file`; lo que sigue abierto); límites conocidos: `Málaga`/`Malaga` y variantes de mayúsculas siguen duplicando carpetas, y las carpetas existentes en NFD o con caracteres que la regla rechace dejan de poder actualizarse o borrarse por estas rutas (por confirmar si existen); hallazgos nuevos: (1) `localeCompare` ordena `_v10` antes que `_v9` en `deleteFileFromS3` (`aws/awsS3connect.js`, ordenación de la versión más reciente), (2) letras confundibles (homoglifos) no se detectan. Fecha "actualizado" de hoy, métricas al día; retirar los avisos de `security/detect-object-injection` si desaparecen.
2. `docs/05-modulos.md` y `docs/06-almacenamiento-s3.md`: fuente de fecha UTC, validación de provincia y de clave (rechazo de lo no NFC), prefijo con barra final en listados.
3. `docs/04-api.md`: los nuevos 400 de `POST /upload`, `POST /upload/confirm`, `POST /update-file` y `POST /delete-file`.
4. `docs/guias/buenas-practicas-backend.md` (validación de entrada) y `docs/guias/seguridad.md` (claves de S3): filas de estas rutas con la regla de provincia y de clave.
5. `docs/integracion/para-frontend.md`: D2 sin cambios; nuevos 400; el día del nombre pasa a ser UTC; condiciones de compatibilidad (ver contratos).

## Fuera de alcance

- Normalizar mayúsculas o acentos (más allá de NFC en la provincia del Excel) y lista cerrada de provincias.
- Normalizar o reescribir las claves que manda el cliente.
- Letras confundibles (homoglifos): hallazgo nuevo a anotar.
- La ordenación por `localeCompare` (`_v10` antes que `_v9`) en `deleteFileFromS3`: hallazgo nuevo a anotar; no se corrige aquí.
- Borradores no confirmados (A2; `drafts` solo se reserva como nombre), sobrescritura por carreras (M1), `GET /get-data/:path(*)` (M2), claves de imágenes y términos (M5), tamaño (M6).
- Migración o renombrado de carpetas ya existentes en el bucket (incluida una posible `Desconocido`, carpetas en NFD o con nombres que la nueva regla rechace).
- Cambio del formato del nombre de archivo y del parser del frontend.
- Introducir una base de tests (M11).

## Impacto en contratos externos

- `docs/integracion/para-frontend.md`: compatible, condicionada. Verificado en el documento: el formato D2 no cambia y `GET /list-files` conserva su forma; la tabla de campos que lee el frontend solo usa el estado de `upload/confirm`, `update-file` y `delete-file`, y `data.emptyFields`/`data.draftKey` del 400 de `/upload`, que no cambian. Cambios visibles: `POST /upload` responde 400 en casos antes aceptados (provincia ausente, inválida, reservada o varias provincias), el día del nombre pasa a ser UTC (entre las 00:00 y las 01:00-02:00 de España puede llevar el día anterior al local), y `upload/confirm`, `update-file` y `delete-file` responden 400 con claves mal formadas o con provincia no NFC (antes llegaban a S3). Es compatible si el frontend manda siempre claves que salieron de `GET /list-files` o de `draftKey`, y las carpetas reales cumplen la regla y están en NFC. Si existe una carpeta en NFD o con un nombre que la regla rechace, esa versión no se podría activar ni borrar desde el panel: es incompatible para ese caso. Nada de esto se puede comprobar con el documento; queda **(por confirmar)** contra el código del frontend (`FileDropdown`, `FileUpload`) y contra las carpetas reales del bucket. Al cerrar, revisar la sección 6 de `docs/guias/mantenimiento.md`.
- `docs/integracion/para-infra.md`: no lo afecta (sin variables de entorno, IAM ni endpoints nuevos).

## Preguntas abiertas

Ninguna. Decisión del usuario incorporada: en `draftKey` y `fileName`, un segmento de provincia que no esté en NFC se rechaza con 400, sin normalizar ni reescribir la clave del cliente.
