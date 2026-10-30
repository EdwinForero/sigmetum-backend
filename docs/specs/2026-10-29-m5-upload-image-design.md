# M5, validar el tipo y el título en POST /upload-image: spec

Fecha: 2026-10-29 · Estado: cerrado

## Objetivo

`POST /upload-image` confía en el MIME que manda el cliente (`file.mimetype`, que también se guarda como `ContentType` del objeto) y no comprueba el tipo del fichero. El nombre del objeto sale de `title` (solo `\s+` pasa a `_`) más lo que hay desde el último `.` de `originalname`, sin lista de permitidos. Mientras tanto `GET /get-image` y `DELETE /delete-image` solo aceptan claves que cumplen `IMAGE_KEY_PATTERN`/`isValidImageKey`: hoy se puede subir un objeto que esas dos rutas no admiten y que quedaría sin poder pedirse ni borrarse. Se busca que lo que se sube sea una imagen de un tipo permitido y que la clave resultante sea siempre válida para lectura y borrado.

Comportamiento actual (comprobado en `routes/content.js` y `aws/awsS3connect.js`):

- Sin `file` o sin `title` (cadena no vacía): `400` `File and title are required`.
- Clave = `title` con `\s+` sustituido por `_` + subcadena desde el último `.` de `originalname`. Sin recortar el título; sin límite de longitud; `/`, `..`, `\`, caracteres de control y similares se aceptan en el título. Un `originalname` sin punto aporta como "extensión" el nombre completo.
- El `ContentType` guardado es el declarado por el cliente.
- Una subida con una clave ya existente sobrescribe el objeto sin aviso.
- Respuesta `200`: `{ success: true, data: { key: "gallery/<clave>" } }` (con prefijo; `imageKey` de `get-image`/`delete-image` es relativo a `gallery/`, y `fileName` de `GET /list-images` también).
- Tamaño máximo 5 MB ya resuelto (M6).

## Decisiones del usuario (29/10/2026)

1. Tipos aceptados: jpg/jpeg, png, gif y webp (los del `accept` del frontend y los que ya admite `IMAGE_KEY_PATTERN`; la regla de lectura no se toca). La extensión se normaliza a minúsculas en la clave. Sin SVG, avif ni heic.
2. Validación del tipo: extensión y MIME declarado coherentes entre sí, y además la firma (magic bytes) del contenido (JPEG, PNG, GIF, WebP), sin dependencias nuevas. El backend fija el `ContentType` a partir del tipo validado, no del que manda el cliente.
3. Título: se sanea (recorte y blanco, incluidos `\t` y `\n`, a `_`; se quitan los puntos finales) y se rechaza con `400` si lleva `/`, `\`, `..` o caracteres de control que no son blanco, o si la clave resultante no pasa `isValidImageKey`. Longitud máxima del título coherente con `IMAGE_KEY_MAX_LENGTH` (la clave completa, con extensión, no puede pasar de 200 caracteres).
4. Rechazo: `400` con mensaje fijo por causa (tipo no permitido, título no válido, contenido que no corresponde al tipo), en inglés, sin reflejar el MIME, el título ni `err.message`. Clasificación: compatible condicionada.
5. Sobrescritura: se mantiene la sobrescritura silenciosa de una clave repetida y se documenta (un `409` cambiaría el contrato). Los objetos ya subidos con claves que la regla rechaza solo se documentan como riesgo residual hasta el GATE de M21; no hay tarea de migración.

## Criterios de aceptación

### De código

Todos comprobables con tests de `node:test` + `supertest` (S3 simulado, como en `tests/limite-subida.test.js`), que deben fallar antes del cambio.

1. Un fichero cuya extensión o MIME declarado no es de {jpg/jpeg, png, gif, webp}, o cuyos extensión y MIME no son coherentes entre sí (por ejemplo `a.png` con `image/jpeg`, `a.bmp`, `a.svg`, `a.heic`, sin extensión), responde `400` con un mensaje fijo de tipo no permitido, sin reflejar el MIME ni el nombre, y no llama a S3. Hoy responde `200`.
2. Un fichero con extensión y MIME permitidos y coherentes pero cuyo contenido no tiene la firma de ese tipo (por ejemplo texto con nombre `.jpg` y MIME `image/jpeg`) responde `400` con un mensaje fijo distinto (contenido que no corresponde al tipo) y no llama a S3. Hoy responde `200`. Los casos válidos usan buffers mínimos con firma real de JPEG, PNG, GIF y WebP.
3. Un fichero válido y un título válido responden `200` con `data.key`; la clave construida, sin el prefijo `gallery/`, supera `isValidImageKey` (el test llama a la función real, no a una copia de la regla). La extensión de la clave va en minúsculas aunque el original sea `.JPG`.
4. Un título con `/`, `\`, `..` o caracteres de control que no son blanco (el blanco, incluidos `\t` y `\n`, se sanea a `_`), vacío tras recortar, o que haga la clave más larga que `IMAGE_KEY_MAX_LENGTH`, o cuya clave no pase `isValidImageKey`, responde `400` con un mensaje fijo de título no válido, sin reflejar el título, y no llama a S3. Un título con espacios (también en los extremos), tildes, ñ o mayúsculas se sanea (recorte y `\s+` a `_`) y responde `200`. Hoy un título con `/` o `..` da `200`.
5. Para cualquier combinación de títulos y extensiones de prueba el resultado es solo uno de dos: `400` sin tocar S3, o `200` con una clave que cumple `isValidImageKey`. Nunca `200` con una clave que `get-image`/`delete-image` rechazarían.
6. El `ContentType` con el que se guarda el objeto es el del tipo validado (`image/jpeg`, `image/png`, `image/gif`, `image/webp`), no el texto del cliente; el test lo comprueba con el mock de S3 (por ejemplo `a.JPG` con `image/jpeg` guarda `image/jpeg`).
7. Los mensajes de los tres `400` nuevos son distintos entre sí, fijos y en inglés; ninguno incluye el MIME, el título, el nombre del fichero ni `err.message`.
8. Sin `file`, sin `title` o con otro nombre de campo, y los límites de M6, conservan su respuesta actual (`400` `File and title are required`, `File upload error: ...`, `File exceeds the maximum allowed size`). Sin token sigue dando `401` (`tests/rutas-protegidas.test.js`). Una clave repetida sigue sobrescribiendo sin error.
9. Ida y vuelta: una clave devuelta por `POST /upload-image` (con el prefijo `gallery/` quitado) es aceptada por `GET /get-image` y `DELETE /delete-image` (ambos pasan `isValidImageKey`).
10. `npm test`, `npm run lint`, `npm run quality` y `npm run docs:check` pasan; `npm run docs:gate` antes del commit. Sin dependencias nuevas (`package.json` y `package-lock.json` sin cambios).

### De documentación

1. `docs/04-api.md` (`POST /upload-image`): tipos aceptados, regla del título, los tres `400` nuevos con su texto, normalización de la extensión, sobrescritura silenciosa.
2. `docs/05-modulos.md`: constantes o funciones nuevas o cambiadas y su ubicación.
3. `docs/06-almacenamiento-s3.md`: cómo se construye la clave de una imagen y su coherencia con la regla de `imageKey`; el aviso de claves que la regla rechaza queda limitado a los objetos subidos antes del cambio (riesgo residual hasta el GATE de M21).
4. `docs/guias/seguridad.md` y `docs/guias/buenas-practicas-backend.md`: filas de tipo de fichero de imagen y de claves al día, sin cambiar un estado "No cumple" sin motivo.
5. `docs/integracion/para-frontend.md`: fila nueva o ampliada de "Tipo de fichero en `/upload-image`" con la clasificación (compatible condicionada), los `400` nuevos y el `accept` actual del frontend (`image/jpeg, image/png, image/gif, image/webp`); revisar la fila de límites de tamaño o tipo de la sección 5. `docs/integracion/para-infra.md`: sin cambios.
6. `docs/07-estado-y-deuda-tecnica.md`: M5 resuelta con fecha y lo que quede abierto (sobrescritura silenciosa, objetos antiguos), fecha "actualizado" de hoy, métricas y "Prioridades sugeridas" al día. Aviso para PR en `docs/specs/` (se toca `routes/**` y cambia el comportamiento visible).

## Fuera de alcance

- B5 y B9 (errores de S3 y `NoSuchKey` a 404), A2 y D8.
- Migrar, renombrar o borrar imágenes que ya estén en el bucket; el GATE de `imageKey` contra la galería real sigue siendo de M21.
- Cambiar `GET /get-image`, `DELETE /delete-image`, `GET /list-images` o `IMAGE_KEY_PATTERN`.
- Responder `409` ante una clave repetida (se mantiene la sobrescritura).
- Aceptar SVG, avif, heic u otros tipos.
- Cambios en el frontend (`accept`, mensajes, codificación del `imageKey` en la URL); solo se documentan.
- El límite de tamaño (M6) y `POST /upload`.

## Impacto en contratos externos

- `docs/integracion/para-frontend.md`: lo afecta. Hay `400` donde hoy hay `200` (tipo no permitido, contenido que no corresponde, título no válido) y la extensión de la clave pasa a minúsculas. Clasificación: **compatible condicionada**: el envoltorio no cambia, el `accept` del selector ya restringe a jpeg, png, gif y webp, y el frontend no usa el texto del error (comprobado en la spec M17/M22; volver a comprobarlo). Condición **(por confirmar)**: que el frontend no suba hoy HEIC, SVG ni títulos con `/` o `\` (el selector permite elegir "Todos los archivos", y el título es texto libre). Si resultara que sí, pasaría a revisarse como incompatible (`/api/v2`). Además, el frontend muestra el nombre de la imagen sin extensión y con `_` como espacio, y usa `fileName` como `imageKey`: la normalización a minúsculas de la extensión no lo afecta, pero que no dependa de mayúsculas también es **(por confirmar)**.
- `docs/integracion/para-infra.md`: no lo afecta (sin variables de entorno, IAM, dependencias ni endpoints nuevos).

## Preguntas abiertas

Ninguna. Quedan marcados como **(por confirmar)** los dos puntos del frontend de la sección anterior, que no bloquean la spec.
