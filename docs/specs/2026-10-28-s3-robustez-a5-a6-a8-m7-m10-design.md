# Robustez de S3 (A5/D5, A6, A8, M7, M10): spec

Fecha: 2026-10-28 · Estado: cerrado

## Objetivo

La capa de S3 falla o miente en cinco casos: con la galería vacía `/list-images` responde 500 y, con solo el marcador de carpeta `gallery/`, lo devuelve como imagen de clave vacía (A5/D5); `getTextJsonS3` convierte cualquier fallo en `[]`, de modo que subir o borrar un término puede sobrescribir el glosario entero (A6); los listados se truncan en silencio por encima de 1000 objetos (M10); `/get-merged-data` descarga los activos uno tras otro (M7); y al borrar una versión se elige como "la más reciente" una por orden alfabético, no numérico (`_v10` antes que `_v9`) (A8). Esta spec define el comportamiento esperado de los cinco, en un solo ciclo y un solo commit. Todos los criterios se comprueban con `S3Client.prototype.send` parcheado (los errores reales de S3 no se pueden reproducir contra S3 real).

## Criterios de aceptación

### De código

Cada criterio se demuestra con un test que falla antes del cambio y pasa después (base `node:test` + `supertest`; el aws real con `S3Client.prototype.send` parcheado, como en `tests/aws-prefijo.test.js`).

A5 / D5:
1. Con el listado de `gallery/` sin objetos, `GET /list-images` responde 200 `{ success: true, data: [] }` (hoy 500).
2. Con el listado de `gallery/` que solo contiene el marcador de carpeta (clave `gallery/`, tamaño 0), `GET /list-images` responde 200 con `data: []`. Se excluyen de `/list-images` y de `getPresignedUrlsFromS3Folder` los objetos cuya clave termine en `/` o con tamaño 0 (hoy el marcador se devuelve con `fileName` vacío).
3. Con imágenes reales, el formato `{ fileName, url }` de cada elemento no cambia.
4. Un fallo real de S3 al listar (por ejemplo `AccessDenied`) sigue produciendo el error por `next(error)`, no `[]`.
5. Criterio de "objeto real" único y compartido: clave sin `/` final y `Size > 0`. Lo aplican por igual `listFilesInS3Folder` y `getPresignedUrlsFromS3Folder`, de modo que no pueden divergir. Un test comprueba que ambas excluyen los mismos objetos para el mismo listado (marcador `/`, tamaño 0).

A6:
6. Si `GetObject` del glosario falla con `NoSuchKey`, `getTextJsonS3` devuelve `[]` y `GET /list-terms` responde 200 `data: []` (comportamiento actual que se conserva).
7. Si `GetObject` falla con cualquier otro error (permisos, red, 5xx) o el contenido no es JSON válido, `getTextJsonS3` propaga el error y `GET /list-terms` responde 500 `{ success: false, error }` genérico por `next(error)`, sin `err.message` del error interno. Hoy responde 200 `[]`.
8. Si el contenido es un JSON válido que no es un array (por ejemplo `{}`), el resultado es el mismo que en el criterio 7: 500 genérico y, en añadir y borrar término, sin `PutObject` (el glosario no se sobrescribe).
9. En el fallo del criterio 7, `uploadTextToJsonS3` no llama a `PutObject` y la ruta de añadir término responde 500 genérico por `next(error)`.
10. En el fallo del criterio 7, `deleteTermFromS3` no llama a `PutObject` y la ruta de borrar término responde 500 genérico por `next(error)` (hoy devuelve `{ success: false }` tras sobrescribir con `[]`).
11. Con `NoSuchKey`, subir el primer término sigue creando el glosario con ese único término.

M10:
12. Con un listado que S3 devuelve en varias páginas (`IsTruncated` con `NextContinuationToken`), `listFilesInS3Folder` y `getPresignedUrlsFromS3Folder` recorren todas las páginas hasta `IsTruncated=false`, sin tope de páginas (hoy solo la primera). Los consumidores (`/list-files`, `getNextVersion`, `deleteFileFromS3`, `getMergedDataInS3Folder`, `/list-images`) ven la lista completa.
13. Guardia contra bucle infinito: si S3 responde `IsTruncated=true` repitiendo el mismo `NextContinuationToken` que ya se usó, la función lanza un error en lugar de iterar sin fin (se comprueba con un `send` parcheado que repite el token).
14. Una página intermedia sin `Contents` se trata como lista vacía de esa página y la paginación continúa con las siguientes; no lanza.
15. El formato `{ name, key }` de `listFilesInS3Folder` no cambia.

M7:
16. `getMergedDataInS3Folder` devuelve exactamente el mismo resultado que hoy (mismo contenido y mismo orden de concatenación que el listado) pero las lecturas de los activos se inician sin esperar a que termine la anterior. Se comprueba con un `send` parcheado que retrasa cada lectura y verifica que hay más de una lectura en curso a la vez, y que el orden del resultado no depende del orden en que terminan.
17. Si una lectura falla, `getMergedDataInS3Folder` rechaza igual que hoy (no devuelve datos parciales).

A8:
18. Con `2026-10-28_v9.xlsx` y `2026-10-28_v10.xlsx` presentes tras un borrado, `deleteFileFromS3` regenera el activo a partir de la `_v10` (hoy toma la `_v9`). Se comprueba con la clave leída por `GetObject` y el cuerpo escrito en `PutObject`.
19. El orden es por fecha y, dentro de la misma fecha, por número de versión `N` como entero; con fechas distintas manda la fecha más reciente. Si fecha y `N` coinciden (por ejemplo `_v7` y `_v007`), el desempate es determinista (el resultado no depende del orden del listado); el criterio concreto de desempate lo fija el architect.
20. Tras borrar, `deleteFileFromS3` distingue tres casos sobre los `.xlsx` que quedan en la carpeta de la provincia:
    - (a) Hay al menos uno con nombre estándar `AAAA-MM-DD_vN.xlsx`: se regenera el activo desde el más reciente (criterios 18 y 19); los de nombre no estándar se ignoran.
    - (b) Quedan `.xlsx` pero ninguno con nombre estándar: el activo no se toca (ni `DeleteObject` ni `PutObject` sobre la clave del activo). Motivo: `/upload/confirm` con `confirmed=false` llama a `deleteFileFromS3`; si alguien subió a mano un `.xlsx` de nombre libre, cancelar un borrador no debe borrar un activo válido y en uso.
    - (c) No queda ningún `.xlsx`: se borra el activo, como hoy.
21. `getNextVersion` ya calcula `N` como entero con su propia expresión regular: un test con `_v9` y `_v10` debe demostrar que el siguiente es `_v11`. Si ya pasa antes del cambio, el test documenta el comportamiento y se dice. La interpretación del nombre de versión es única y compartida entre `getNextVersion` y `deleteFileFromS3` (el archivo nuevo `functions/versionName.js` se menciona en la documentación; el diseño es del architect).

Generales:
22. `npm test`, `npm run lint`, `npm run quality` pasan; no se añaden dependencias ni permisos nuevos.
23. Si el aviso de ESLint por `catch` con variable sin usar desaparece con este cambio, `--max-warnings` baja a 4 (verificar el número real al terminar) y se actualiza la mención en la guía correspondiente.
24. Ningún cambio de rutas, envoltorio `{ success, data | error }`, claves de S3, columnas del Excel, JWT ni CORS, salvo lo descrito en A5 y A6. El único cambio de comportamiento observable que requiere aviso en la PR es A6.

### De documentación

1. `docs/07-estado-y-deuda-tecnica.md`: A5, A6, A8, M7 y M10 marcados como resueltos con fecha; D5 en la tabla de frontend marcado como resuelto en el backend; fecha "actualizado" de hoy; métricas (tests) al día; la nota de A5 sobre el marcador pasa de "(por confirmar)" a lo que demuestren los tests; el orden de prioridades actualizado.
2. `docs/04-api.md`: `/list-images` con galería vacía responde `[]`; `/list-terms` y las rutas de añadir y borrar término responden 500 genérico ante un fallo de S3 distinto de `NoSuchKey`.
3. `docs/05-modulos.md` y `docs/06-almacenamiento-s3.md`: comportamiento nuevo de `getTextJsonS3` (solo `NoSuchKey` es "no existe"), paginación completa con su guardia, lecturas en paralelo, criterio de orden de versiones y los tres casos de `deleteFileFromS3`, criterio de "objeto real". `docs/05-modulos.md` y la estructura de `docs/README.md` documentan el archivo nuevo `functions/versionName.js`.
4. Efecto de A6 documentado de forma explícita (en `docs/07`, `docs/04-api.md` y `docs/06`): un glosario de 0 bytes, con JSON corrupto o con JSON que no sea un array ya no se "autocura" al añadir un término. Bloquea `list-terms`, `upload-term` y `delete-term` (500) hasta reparar el objeto a mano en S3.
5. `docs/integracion/para-frontend.md`: D5 resuelto en el backend; A6 anotado como cambio compatible con aviso.
6. `docs/integracion/para-infra.md`: confirmar que los permisos IAM no cambian (la paginación usa la misma acción `s3:ListBucket`, ya concedida; la política no se modifica aquí). Riesgo anotado en el punto siguiente.
7. La guía que mencione el tope de `--max-warnings` se actualiza si el criterio 23 se cumple.
8. Aviso para PR (`docs/specs/*-aviso-pr.md`): A6 como único cambio de comportamiento observable.

## Riesgos y por confirmar

- Perfil SSO local: sin el permiso `s3:ListBucket`, S3 devuelve `AccessDenied` en lugar de `NoSuchKey` cuando el glosario no existe, y `GET /list-terms` daría 500 en local. El rol de Beanstalk sí lo tiene en `sigmetum-infra` (política `beanstalk_s3`). Falta confirmar que el perfil SSO local lo tiene (por confirmar).
- Que el frontend no dependa del elemento de clave vacía del marcador (por confirmar).
- Que la política IAM real coincide con lo documentado en `para-infra.md` (por confirmar).

## Fuera de alcance

- B5/B9 (estilos de error y `NoSuchKey` → 404 en rutas de lectura de datos).
- A2 (borradores aparte) y D8.
- Caché de `/get-merged-data` (M8) y cualquier cambio de tamaño de respuesta de `/list-images`.
- Cambios en el frontend, en `sigmetum-infra` o en la política IAM.
- Pruebas contra un S3 real.

## Impacto en contratos externos

- `docs/integracion/para-frontend.md`: sí.
  - A5: `/list-images` con galería vacía pasa de 500 a 200 `[]`. Compatible (es lo que pide D5). El elemento de clave vacía por el marcador deja de aparecer: que el frontend no dependa de él es (por confirmar).
  - A6: un fallo de permisos o red en `GET /list-terms` pasa de 200 `[]` a 500 genérico. Decisión del usuario: compatible (no cambia envoltorio ni campos; `NoSuchKey` sigue dando 200 `[]`), con aviso en la PR.
  - M7, M10, A8: sin cambio de formato. `/list-files` y `/get-merged-data` dejan de truncarse con más de 1000 objetos (más datos, mismo formato).
- `docs/integracion/para-infra.md`: no lo afecta. Sin variables de entorno nuevas; `ListObjectsV2` paginado usa `s3:ListBucket`, ya concedido (por confirmar contra la política real).

## Preguntas abiertas

Ninguna. Decisiones del usuario incorporadas: A6 compatible con aviso en la PR y 500 genérico en añadir/borrar término; A5 excluye claves terminadas en `/` o de tamaño 0; M10 paginación completa sin tope (con guardia contra token repetido); A8 ignora nombres que no encajan, ordena `N` numéricamente y no toca el activo si solo quedan `.xlsx` no estándar; un solo ciclo y un solo commit.
