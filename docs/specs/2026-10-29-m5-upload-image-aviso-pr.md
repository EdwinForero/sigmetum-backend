# Aviso para PR: M5, validar tipo, título y contenido en POST /upload-image

Fecha: 2026-10-29 · Spec: `docs/specs/2026-10-29-m5-upload-image-design.md` · Plan: `docs/specs/2026-10-29-m5-upload-image-plan.md`

Se tocan áreas de contrato: `routes/content.js` (`routes/**`) y `config/s3Paths.js`.

## Qué cambia

- `POST /upload-image` responde `400` donde antes respondía `200`, con tres textos fijos (en inglés, sin reflejar el MIME, el título ni el nombre del fichero): `Image type not allowed`, `Image title is not valid` y `File content does not match the image type`. El `400` `File and title are required` no cambia. Se comprueban en ese orden: tipo, título, firma.
- Solo se aceptan `.jpg`, `.jpeg`, `.png`, `.gif` y `.webp`, con su MIME exacto (`image/jpeg`, `image/png`, `image/gif`, `image/webp`) y con la firma real del contenido. `image/jpg`, MIME vacío y `application/octet-stream` dan `400`. `.jfif`, `.jpe` y `.pjpeg` (que el `accept` actual deja elegir) ya no se suben.
- La extensión de la clave va en minúsculas: `foto.JPG` y `foto.jpg` son la misma clave y la segunda sobrescribe a la primera sin aviso (se mantiene la sobrescritura silenciosa).
- El título se sanea (recorte, blanco a `_`, puntos finales quitados) y da `400` si lleva `/`, `\`, `..` o un carácter de control que no es blanco, queda vacío o la clave no cumple la regla de lectura de `imageKey`. Efecto: títulos con `,` `'` `:` `&` `#` `?` `%` (por ejemplo `Encinar, vista 1` o `Bosque d'Or`) dan `400`, porque `GET /get-image` y `DELETE /delete-image` no los admiten y no se ha tocado esa regla.
- El `ContentType` del objeto lo fija el backend (el MIME canónico del tipo validado).
- La respuesta `200` no cambia: `{ success: true, data: { key: "gallery/<clave>" } }`.

## Qué debe hacer cada repositorio

- **Frontend (`sigmetum-frontend`)**: clasificación **compatible condicionada** (mismo envoltorio; el `accept` del selector ya restringe a jpeg, png, gif y webp). Integración: confirmar, antes de desplegar, que **(por confirmar)** el frontend no sube HEIC ni SVG (el selector permite "Todos los archivos"), ni títulos con `, ' : & # ? %`, `/` o `\`, ni depende de mayúsculas en la extensión, y probar con un cliente real el MIME en mayúsculas y el MIME vacío de `.webp` en un sistema sin registro de tipo. Recomendable que muestre el error del `400` y limite el título a los caracteres admitidos. Si alguna condición falla, se revisa como incompatible (`/api/v2`). Detalle en `docs/integracion/para-frontend.md`.
- **Infraestructura (`sigmetum-infra`)**: Integración: sin impacto — no hay variables de entorno, permisos IAM, dependencias ni endpoints nuevos (`docs/integracion/para-infra.md` sin cambios).

## Riesgos residuales

- Los objetos subidos antes con claves que la regla rechaza siguen en el bucket y no se pueden pedir ni borrar con `GET /get-image` y `DELETE /delete-image`; no hay migración (comprobación contra la galería real **(por confirmar)** con el GATE de M21).
- Un polyglot imagen+script con cabecera válida pasa: la firma no sustituye un reprocesado de la imagen. Sin normalización NFC del título.
