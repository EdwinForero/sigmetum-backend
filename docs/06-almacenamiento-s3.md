# Almacenamiento en S3 y versionado

## Estructura del bucket

```
<AWS_BUCKET_NAME>/
├── gallery/
│   ├── Encinar.jpg
│   └── ...
└── data/
    ├── active/                     ← lo que ve el público
    │   ├── Malaga.json
    │   └── Granada.json
    ├── terms/
    │   └── noLatinTerms.json       ← glosario [{ "term": "..." }]
    ├── Malaga/                     ← historial de versiones (Excel originales)
    │   ├── 2026-01-10_v1.xlsx
    │   ├── 2026-01-15_v1.xlsx
    │   └── 2026-01-15_v2.xlsx
    └── Granada/
        └── ...
```

Los prefijos están en `config/s3Paths.js`. `active` y `terms` están en `RESERVED_SEGMENTS` para que `/list-files` no los trate como provincias. Todo listado por prefijo (`listFilesInS3Folder`) añade una `/` final al `Prefix` si falta, así que listar `data/Santa Cruz` no recoge `data/Santa Cruz de Tenerife/...` ni `data/active` recoge `data/activos/...`.

**Listados y objetos reales (A5, M10; 29/10/2026).** Los listados recorren **todas** las páginas de `ListObjectsV2` (`IsTruncated` con `NextContinuationToken`), sin tope de páginas; si S3 dice que hay más páginas y no da token, o repite uno ya usado, la función lanza en vez de iterar sin fin. Una página sin `Contents` cuenta como vacía y continúa. Un «objeto real» es el que tiene la clave sin `/` final y `Size > 0`; el marcador de carpeta (`gallery/`) y los objetos de tamaño 0 se excluyen igual de `listFilesInS3Folder` y de las URL prefirmadas, y la galería vacía o con solo el marcador da `[]` en `GET /list-images`. La paginación usa la misma acción `s3:ListBucket` que antes.

**Lecturas de JSON (A6).** El glosario (`data/terms/noLatinTerms.json`) solo se trata como «vacío» si S3 responde `NoSuchKey`; cualquier otro fallo, un objeto de 0 bytes, un JSON corrupto o un JSON que no es un array se propaga y las tres rutas de glosario responden `500` sin escribir. **Un glosario ilegible ya no se autocura**: hay que repararlo a mano en S3 (por ejemplo, subir un `[]` válido) para desbloquear `list-terms`, `upload-term` y `delete-term`. `/get-merged-data` lee los activos en paralelo y concatena en el orden del listado.

## Modelo de versionado

- Cada subida de Excel crea un objeto nuevo en `data/{Provincia}/` con nombre `YYYY-MM-DD_vN.xlsx`. La fecha es el día **UTC** (la misma fuente en `getNextVersion` y `formatFileName`; entre las 00:00 UTC y las 01:00-02:00 de España el nombre lleva el día anterior al local). `N` empieza en 1 cada día y se incrementa si ya hay subidas ese día. El nombre se interpreta en un solo sitio (`parseVersionName`, que usa `DATA_FILE_NAME_PATTERN`): `N` es un entero y el orden de versiones es por fecha y luego por `N` (`_v10` es posterior a `_v9`; con `_v7` y `_v007` gana el nombre mayor por unidades de código).
- Los Excel **nunca se modifican**; son el historial.
- `data/active/{Provincia}.json` es una **proyección** de una de esas versiones: se regenera convirtiendo el Excel elegido. Hay exactamente un activo por provincia.
- `/get-merged-data` concatena todos los activos: es la fuente de datos pública.

## Ciclo de vida

```
            POST /upload
                 │
     Excel guardado en data/{prov}/fecha_vN.xlsx
                 │
       ¿celdas vacías? ──no──► escribe data/active/{prov}.json   (200)
                 │sí
                 ▼
          respuesta 400 con draftKey
                 │
       POST /upload/confirm
          ├─ confirmed: true  ─► updateFileS3(draftKey) → activo = borrador
          └─ confirmed: false ─► deleteFileFromS3(draftKey) → activo = última versión restante (tres casos, ver abajo)
```

Operaciones de mantenimiento:

- **Cambiar versión activa**: `POST /update-file` con la clave de cualquier Excel del historial.
- **Borrar una versión**: `POST /delete-file`. Tras borrar, se miran los `.xlsx` que quedan en la carpeta de la provincia (el mismo borrado ocurre con `/upload/confirm` y `confirmed: false`): (a) si hay alguno con nombre estándar, el activo se regenera desde el más reciente por fecha y `N` entero (los de nombre no estándar se ignoran); (b) si solo quedan `.xlsx` de nombre no estándar (subidos a mano), el activo **no se toca**, para que cancelar un borrador no borre un activo válido; (c) si no queda ningún `.xlsx`, se borra el activo.

### Regla de provincia

`POST /upload` construye `data/{provincia}/...` y `data/active/{provincia}.json` con la celda `Provincia` de la primera fila, así que la valida antes (`validateProvincia`, `functions/validateProvincia.js`). El valor se recorta (trim) y se normaliza a NFC; ese valor es el que va a las claves de S3. Es válido si:

- Es una cadena de 1 a 50 caracteres (tras recortar y NFC).
- Son palabras de letras Unicode (con marcas combinantes) separadas por **un solo** espacio o guion, siempre entre letras. Se rechazan `/`, `\`, `.`, dígitos y separadores en los extremos o dobles (`Alicante/Alacant` y `Castellón/Castelló` se rechazan por la barra).
- No es `active`, `terms` ni `drafts`, no empieza (en minúsculas) por `active` o `terms` y no es un nombre de propiedad de objeto (`__proto__`, `constructor`, `toString`, `prototype`...). `Activos` se acepta: la colisión con `data/active/` la evita el prefijo con barra.
- Todas las filas que traen la clave `Provincia` la tienen igual (tras trim y NFC) que la primera fila; las que no la traen se guardan bajo la provincia de la primera.

**Límites conocidos**: no se cambian mayúsculas ni acentos más allá de NFC, así que `Málaga`, `Malaga` y `málaga` siguen siendo carpetas distintas; las letras confundibles entre alfabetos (homoglifos, p. ej. una `а` cirílica) no se detectan (M23 en [07](07-estado-y-deuda-tecnica.md)); la carpeta usa la provincia normalizada pero `processedData` (y el JSON activo) conserva el valor original de las celdas; una carpeta existente en NFD o con un nombre que la regla rechace (incluida una posible `Desconocido`) ya no se puede actualizar ni borrar con las rutas de versión **(por confirmar si existen en dev y prod)**.

### Regla de clave de versión

`POST /upload/confirm` (`draftKey`), `POST /update-file` y `POST /delete-file` (`fileName`) validan la clave con `isValidDataKey` (`functions/validateDataKey.js`) antes de usarla. Es válida si es una cadena de hasta 120 caracteres con exactamente tres segmentos separados por `/`: `data`, una provincia que pasa la regla anterior **y** ya está en NFC, y un nombre `AAAA-MM-DD_vN.xlsx` (`DATA_FILE_NAME_PATTERN`; `v\d+` admite `_v0` y `_v007`). La clave del cliente nunca se normaliza ni se reescribe: una provincia en NFD se rechaza. No comprueba que el objeto exista.

## Formato del JSON activo

Array de objetos, uno por fila del Excel, con las claves de `fixedColumnOrder`. Los valores con comas son arrays:

```json
[
  {
    "Provincia": "Malaga",
    "Municipio": "Ronda",
    "Altitud Media": 739,
    "Sector Biogeográfico": "Rondeño",
    "Piso Bioclimático": "Mesomediterráneo",
    "Ombrotipo": "Subhúmedo",
    "Naturaleza del Sustrato": "Básico",
    "Tipo de Serie": "Climatófila",
    "Serie de Vegetación": "...",
    "Vegetación Potencial": "Encinar",
    "Especies Características": ["Quercus rotundifolia", "Pistacia lentiscus"]
  }
]
```

Las filas con celdas vacías confirmadas aparecen sin esas claves.

## Imágenes

`gallery/{título}{extensión}`. Se sirven siempre por URL prefirmada de 1 hora; el bucket no necesita ser público.

### Regla de `imageKey`

`GET /get-image` y `DELETE /delete-image` construyen la clave como `gallery/{imageKey}` con texto del cliente, así que antes de llamar a S3 lo validan con `isValidImageKey` (`functions/validateImageKey.js`, constantes en `config/s3Paths.js`). Un `imageKey` es válido si:

- Es una cadena de 1 a 200 caracteres.
- Son uno o más segmentos separados por un único `/`. Cada segmento empieza por una letra o número Unicode (`\p{L}`, `\p{N}`, tildes y ñ incluidas) o por uno de `_ - ( ) +`, y sigue con letras, números, marcas combinantes (`\p{M}`, para nombres en forma NFD, por ejemplo los que genera macOS) y los signos `. _ - ( ) +`.
- Termina en `.jpg`, `.jpeg`, `.png`, `.gif` o `.webp`, sin distinguir mayúsculas (las del selector del panel del frontend; `gif` está porque el frontend lo acepta).
- No contiene `..`, ni `/` inicial, ni `//`, ni un segmento que empiece por `.` o por una marca combinante, ni barra invertida, espacios o caracteres de control.

El patrón está escrito en forma plana con lookaheads (`(?!.*\/\/)(?!.*\/[.\p{M}])`) en vez de segmentos anidados: la versión anidada disparaba `security/detect-unsafe-regex`. La comprobación de `..` es aparte, como defensa en profundidad.

No se exige que la clave exista en el listado de la galería. **Límite conocido**: `\p{N}` incluye dígitos y letras numéricas de ancho completo (fullwidth); se aceptan y no se normalizan. **Riesgo residual aceptado**: se pueden firmar (y borrar, con token) objetos bajo `gallery/` que cumplan la regla aunque `GET /list-images` no los liste. `POST /upload-image` aún no valida el MIME ni el nombre (M5), así que pueden existir en S3 claves que la regla rechaza (por ejemplo, con espacios o con otra extensión): quedarían sin poder pedirse ni borrarse con estas dos rutas. Comprobación contra el listado real de la galería: **(por confirmar)**, ver M21 en [07](07-estado-y-deuda-tecnica.md).

## Glosario

`data/terms/noLatinTerms.json`, array `[{ "term": "..." }]`. Alta y baja con read-modify-write sobre el fichero completo.
