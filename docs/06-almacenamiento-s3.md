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
    ├── drafts/                     ← borradores de POST /upload con celdas vacías (no son versiones)
    │   └── Malaga/
    │       └── 0b5f3c1e-9a7d-4e2b-8c1a-6d4f2e9a1b30.xlsx
    ├── terms/
    │   └── noLatinTerms.json       ← glosario [{ "term": "..." }]
    ├── Malaga/                     ← historial de versiones (Excel originales)
    │   ├── 2026-01-10_v1.xlsx
    │   ├── 2026-01-15_v1.xlsx
    │   └── 2026-01-15_v2.xlsx
    └── Granada/
        └── ...
```

Los prefijos están en `config/s3Paths.js`. `active`, `terms` y `drafts` están en `RESERVED_SEGMENTS` para que `/list-files` no los trate como provincias. Todo listado por prefijo (`listFilesInS3Folder`) añade una `/` final al `Prefix` si falta, así que listar `data/Santa Cruz` no recoge `data/Santa Cruz de Tenerife/...` ni `data/active` recoge `data/activos/...`.

**Listados y objetos reales (A5, M10; 29/10/2026).** Los listados recorren **todas** las páginas de `ListObjectsV2` (`IsTruncated` con `NextContinuationToken`), sin tope de páginas; si S3 dice que hay más páginas y no da token, o repite uno ya usado, la función lanza en vez de iterar sin fin. Una página sin `Contents` cuenta como vacía y continúa. Un «objeto real» es el que tiene la clave sin `/` final y `Size > 0`; el marcador de carpeta (`gallery/`) y los objetos de tamaño 0 se excluyen igual de `listFilesInS3Folder` y de las URL prefirmadas, y la galería vacía o con solo el marcador da `[]` en `GET /list-images`. La paginación usa la misma acción `s3:ListBucket` que antes.

**Errores (B5, 29/10/2026).** Todas las funciones de `aws/` lanzan el error original ante un fallo (ya no hay `{ success: false }`); las rutas lo pasan con `next(error)` y `errorHandler` lo traduce. Un `NoSuchKey` que llegue hasta `errorHandler` responde `404` (B9); `getTextJsonS3` lo convierte antes en `[]` solo para el glosario (A6). `AccessDenied` sigue en `500` salvo en las dos lecturas de solo lectura descritas abajo.

**Qué lecturas toleran `AccessDenied` (S15 y M25, 30/10/2026).** Con `s3:ListBucket` acotado por `Prefix`, S3 puede responder `AccessDenied` (403) en vez de `NoSuchKey` ante una clave que no existe **(por confirmar en dev: qué código devuelve S3 con la política nueva)**. Solo dos lecturas públicas lo tratan como «no existe»: `GET /list-terms` (`getTextJsonS3` con `{ vacioSiAccessDenied: true }`: `200` con `[]`) y `GET /get-data` con una clave permitida (`404`). Todas las demás lecturas y **todas las escrituras** lo propagan: `POST /upload-term` y `DELETE /delete-term` leen el glosario sin la opción, responden `500` y no llaman a `putObject`, porque un permiso roto sobrescribiría el glosario entero con `[]` (A6). Consecuencia: **hasta que exista `data/terms/noLatinTerms.json`** (subir un `[]`, ver [para-infra](integracion/para-infra.md)), el primer alta de término falla con `500` si S3 responde `AccessDenied`. Riesgo residual: un permiso roto se ve como glosario vacío en `list-terms` y como «no existe» en `get-data`.

**Permisos necesarios del rol del backend:** `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` y `s3:ListBucket` con condición `s3:prefix` en `gallery/` y `data/` (que todos los listados lleven `Prefix` dentro de ese ámbito está **por confirmar**).

**Lecturas de JSON (A6).** El glosario (`data/terms/noLatinTerms.json`) solo se trata como «vacío» si S3 responde `NoSuchKey` (y `AccessDenied` solo en `GET /list-terms`, ver arriba); cualquier otro fallo, un objeto de 0 bytes, un JSON corrupto o un JSON que no es un array se propaga y las tres rutas de glosario responden `500` sin escribir. **Un glosario ilegible ya no se autocura**: hay que repararlo a mano en S3 (por ejemplo, subir un `[]` válido) para desbloquear `list-terms`, `upload-term` y `delete-term`. `/get-merged-data` lee los activos en paralelo y concatena en el orden del listado.

## Modelo de versionado

- Cada subida de Excel **sin celdas vacías**, y cada borrador confirmado, crea un objeto nuevo en `data/{Provincia}/` con nombre `YYYY-MM-DD_vN.xlsx`. La fecha es el día **UTC** (la misma fuente en `getNextVersion` y `formatFileName`; entre las 00:00 UTC y las 01:00-02:00 de España el nombre lleva el día anterior al local). `N` empieza en 1 cada día y se incrementa si ya hay subidas ese día. El nombre se interpreta en un solo sitio (`parseVersionName`, que usa `DATA_FILE_NAME_PATTERN`): `N` es un entero y el orden de versiones es por fecha y luego por `N` (`_v10` es posterior a `_v9`; con `_v7` y `_v007` gana el nombre mayor por unidades de código).
- Los Excel **nunca se modifican**; son el historial.
- `data/active/{Provincia}.json` es una **proyección** de una de esas versiones: se regenera convirtiendo el Excel elegido. Hay exactamente un activo por provincia.
- `/get-merged-data` concatena todos los activos: es la fuente de datos pública.

## Ciclo de vida

```
            POST /upload
                 │
       ¿celdas vacías? ──no──► Excel en data/{prov}/fecha_vN.xlsx + activo data/active/{prov}.json   (200)
                 │                  y se descartan los borradores previos de la provincia (mejor esfuerzo)
                 │sí
                 ▼
   Excel en data/drafts/{prov}/<uuid>.xlsx (no es versión; se borran los borradores previos)
                 │
          respuesta 400 con draftKey
                 │
       POST /upload/confirm   (404 Draft not found si el borrador ya no existe)
          ├─ confirmed: true  ─► convierte el borrador → versión nueva data/{prov}/fecha_vN.xlsx
          │                      → activo = esa versión → borra el borrador
          └─ confirmed: false ─► borra solo el borrador (versiones y activo intactos)
```

**Borradores (A2, A9; 29/10/2026).** Un borrador es el Excel de una subida con celdas vacías, guardado en `data/drafts/{provincia}/<uuid>.xlsx` (UUID de `crypto.randomUUID()`). No cuenta como versión: `GET /list-files` no lo muestra (`drafts` está en `RESERVED_SEGMENTS`), `getNextVersion` no lo ve y `/update-file` y `/delete-file` lo rechazan con 400. Por eso cancelar o borrar una versión ya no puede regenerar el activo desde un borrador sin confirmar (A9). Ciclo: (1) se crea en el 400 por celdas vacías; (2) lo sustituye cualquier subida posterior de la provincia, con o sin vacíos (se borran los borradores previos; en la subida completa el descarte es de mejor esfuerzo y, si falla, queda un borrador viejo hasta la siguiente subida de esa provincia); (3) se confirma o (4) se cancela. Al confirmar, el `N` de la versión se calcula sobre las versiones reales de la carpeta de la provincia. Orden de escritura al confirmar: leer el borrador, convertirlo (si falla no queda nada escrito), listar versiones, escribir la versión, escribir el activo con el resultado ya convertido y borrar el borrador. Si se interrumpe antes del borrado, el borrador sigue y repetir la confirmación crea la versión siguiente con el mismo contenido (duplicado asumido).

**Límites aceptados** (M1 queda fuera de alcance): dos subidas con vacíos simultáneas de la misma provincia pueden borrarse mutuamente los borradores (ambos `draftKey` darían 404); una confirmación en curso mientras entra una subida completa de la provincia puede sobrescribir el activo nuevo con datos más antiguos (entre la comprobación de existencia y la escritura); un borrador de 0 bytes no se lista y daría 404; confirmar usa la provincia del `draftKey` sin compararla con el Excel (seguro mientras solo el servidor escribe borradores). Los borradores guardados **antes** del despliegue siguen como versiones en `data/{provincia}/` hasta que el administrador los revise y borre.

El ciclo de vida no cambia con M14 (29/10/2026); solo cambia dónde vive cada regla: `aws/` hace I/O (`deleteFileFromS3` como borrado de clave, `putJsonToS3`), `functions/activeVersion.js` decide (`planActiveAfterDelete`) y `routes/data.js` orquesta (`activateFrom`, `removeVersion`), con las mismas operaciones de S3 en el mismo orden. Ver [05](05-modulos.md).

Operaciones de mantenimiento:

- **Cambiar versión activa**: `POST /update-file` con la clave de cualquier Excel del historial.
- **Borrar una versión**: `POST /delete-file`. Tras borrar, se miran los `.xlsx` que quedan en la carpeta de la provincia (con `/upload/confirm` y `confirmed: false` ya no ocurre: cancelar solo borra el borrador): (a) si hay alguno con nombre estándar, el activo se regenera desde el más reciente por fecha y `N` entero (los de nombre no estándar se ignoran); (b) si solo quedan `.xlsx` de nombre no estándar (subidos a mano), el activo **no se toca**, para que cancelar un borrador no borre un activo válido; (c) si no queda ningún `.xlsx`, se borra el activo.

### Regla de provincia

`POST /upload` construye `data/{provincia}/...` y `data/active/{provincia}.json` con la celda `Provincia` de la primera fila, así que la valida antes (`validateProvincia`, `functions/validateProvincia.js`). El valor se recorta (trim) y se normaliza a NFC; ese valor es el que va a las claves de S3. Es válido si:

- Es una cadena de 1 a 50 caracteres (tras recortar y NFC).
- Son palabras de letras latinas con diacríticos (`\p{Script=Latin}` más marcas combinantes U+0300 a U+036F, salvo U+0345 y U+034F; M23, 30/10/2026) separadas por **un solo** espacio o guion, siempre entre letras. Se rechazan el cirílico (p. ej. la a cirílica U+0430), el griego (p. ej. la alfa U+03B1) y cualquier otro alfabeto, los números romanos, `/`, `\`, `.`, dígitos, apóstrofos y separadores en los extremos o dobles (`Alicante/Alacant` y `Castellón/Castelló` se rechazan por la barra).
- No es `active`, `terms` ni `drafts`, no empieza (en minúsculas) por `active` o `terms` y no es un nombre de propiedad de objeto (`__proto__`, `constructor`, `toString`, `prototype`...). `Activos` se acepta: la colisión con `data/active/` la evita el prefijo con barra.
- Todas las filas que traen la clave `Provincia` la tienen igual (tras trim y NFC) que la primera fila; las que no la traen se guardan bajo la provincia de la primera.

**Límites conocidos**: no se cambian mayúsculas ni acentos más allá de NFC, así que `Málaga`, `Malaga` y `málaga` siguen siendo carpetas distintas; los homoglifos entre alfabetos (una a cirílica U+0430 en `Málaga`) se rechazan desde M23 (30/10/2026), pero **siguen sin detectarse los confundibles dentro del propio latín**: `I` mayúscula frente a `l` minúscula, `Málaga`/`Malaga`, las letras de ancho completo, `ª`, `º`, las letras modificadoras (p. ej. U+02B0) y las latinas `ɑ`, `ɡ`, `ı`, `ſ` y `ᴀ` (límite aceptado, ver M23 en [07](07-estado-y-deuda-tecnica.md)); la carpeta usa la provincia normalizada pero `processedData` (y el JSON activo) conserva el valor original de las celdas; una carpeta existente en NFD o con un nombre que la regla rechace (incluida una posible `Desconocido`) ya no se puede actualizar ni borrar con las rutas de versión **(por confirmar si existen en dev y prod)**.

### Regla de clave de versión

`POST /upload/confirm` (`draftKey`), `POST /update-file` y `POST /delete-file` (`fileName`) validan la clave con `isValidDataKey` (`functions/validateDataKey.js`) antes de usarla. Es válida si es una cadena de hasta 120 caracteres con exactamente tres segmentos separados por `/`: `data`, una provincia que pasa la regla anterior **y** ya está en NFC, y un nombre `AAAA-MM-DD_vN.xlsx` (`DATA_FILE_NAME_PATTERN`; `v\d+` admite `_v0` y `_v007`). La clave del cliente nunca se normaliza ni se reescribe: una provincia en NFD se rechaza. No comprueba que el objeto exista.

### Regla de clave de `GET /get-data` (M25, 30/10/2026)

`GET /get-data/:path(*)` es público y valida la clave con `isValidGetDataKey` (`functions/validateDataKey.js`) antes de llamar a S3: acepta una clave de versión (la regla anterior) o un activo `data/active/{provincia}.json` con la provincia validada por la regla de provincia y en NFC. Todo lo demás (otras raíces, `data/terms`, `data/drafts`, traversal, claves de más de 120 caracteres, la vacía) da `400` `Invalid path` sin tocar S3. Una versión `.xlsx` pasa la regla pero sigue dando `500` por `JSON.parse` (D1, M2 abierto).

### Regla de clave de borrador

`POST /upload/confirm` (`draftKey`) valida la clave con `isValidDraftKey` (`functions/validateDataKey.js`) antes de usarla. Es válida si es una cadena de hasta 120 caracteres con exactamente cuatro segmentos separados por `/`: `data`, `drafts`, una provincia que pasa la regla de provincia **y** ya está en NFC, y un nombre `<uuid en minúsculas>.xlsx` (`DRAFT_FILE_NAME_PATTERN`). Una clave de versión no es un borrador válido (400 `Invalid draftKey`) y una de borrador no es una versión válida (400 `Invalid fileName` en `/update-file` y `/delete-file`). No comprueba que el objeto exista: eso lo hace la ruta listando `data/drafts/{provincia}/` (404 `Draft not found`). Fuera de alcance (M2): `GET /get-data/:path(*)` puede leer cualquier clave, borradores incluidos.

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

`gallery/{título}.{extensión}`. Se sirven siempre por URL prefirmada de 1 hora; el bucket no necesita ser público.

**Cómo se construye la clave al subir (`POST /upload-image`, desde el 29/10/2026, M5):** `validateImageUpload` (`functions/validateImageUpload.js`) toma el título saneado (recorte, blanco a `_`, sin puntos finales) y la extensión en minúsculas, y comprueba `isValidImageKey` sobre el resultado, de modo que una clave subida es siempre válida para `GET /get-image` y `DELETE /delete-image`. Las extensiones admitidas son las de `IMAGE_UPLOAD_TYPES` (`jpg`, `jpeg`, `png`, `gif`, `webp`), un subconjunto de la regla de `imageKey`, y el `ContentType` guardado es el MIME canónico del tipo. Consecuencias: `foto.JPG` y `foto.jpg` son la misma clave (la segunda sobrescribe a la primera sin aviso); no se normaliza a NFC (NFC y NFD del mismo título dan claves distintas); los títulos con `,` `'` `:` `&` `#` `?` `%` se rechazan porque la regla de lectura no los admite.

### Regla de `imageKey`

`GET /get-image` y `DELETE /delete-image` construyen la clave como `gallery/{imageKey}` con texto del cliente, así que antes de llamar a S3 lo validan con `isValidImageKey` (`functions/validateImageKey.js`, constantes en `config/s3Paths.js`). Un `imageKey` es válido si:

- Es una cadena de 1 a 200 caracteres.
- Son uno o más segmentos separados por un único `/`. Cada segmento empieza por una letra o número Unicode (`\p{L}`, `\p{N}`, tildes y ñ incluidas) o por uno de `_ - ( ) +`, y sigue con letras, números, marcas combinantes (`\p{M}`, para nombres en forma NFD, por ejemplo los que genera macOS) y los signos `. _ - ( ) +`.
- Termina en `.jpg`, `.jpeg`, `.png`, `.gif` o `.webp`, sin distinguir mayúsculas (las del selector del panel del frontend; `gif` está porque el frontend lo acepta).
- No contiene `..`, ni `/` inicial, ni `//`, ni un segmento que empiece por `.` o por una marca combinante, ni barra invertida, espacios o caracteres de control.

El patrón está escrito en forma plana con lookaheads (`(?!.*\/\/)(?!.*\/[.\p{M}])`) en vez de segmentos anidados: la versión anidada disparaba `security/detect-unsafe-regex`. La comprobación de `..` es aparte, como defensa en profundidad.

No se exige que la clave exista en el listado de la galería. **Límite conocido**: `\p{N}` incluye dígitos y letras numéricas de ancho completo (fullwidth); se aceptan y no se normalizan. **Riesgo residual aceptado**: se pueden firmar (y borrar, con token) objetos bajo `gallery/` que cumplan la regla aunque `GET /list-images` no los liste. Los objetos subidos **antes del 29/10/2026** (M5) no pasaron por esa validación, así que pueden existir en S3 claves que la regla rechaza (por ejemplo, con espacios, con otra extensión o con `/` o `..` en el título): quedarían sin poder pedirse ni borrarse con estas dos rutas; no hay tarea de migración. Los objetos subidos desde entonces cumplen la regla. Comprobación contra el listado real de la galería: **(por confirmar)**, ver M21 en [07](07-estado-y-deuda-tecnica.md).

## Glosario

`data/terms/noLatinTerms.json`, array `[{ "term": "..." }]`. Alta y baja con read-modify-write sobre el fichero completo.
