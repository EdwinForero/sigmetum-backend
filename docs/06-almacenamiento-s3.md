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

Los prefijos están en `config/s3Paths.js`. `active` y `terms` están en `RESERVED_SEGMENTS` para que `/list-files` no los trate como provincias.

## Modelo de versionado

- Cada subida de Excel crea un objeto nuevo en `data/{Provincia}/` con nombre `YYYY-MM-DD_vN.xlsx`. `N` empieza en 1 cada día y se incrementa si ya hay subidas ese día.
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
          └─ confirmed: false ─► deleteFileFromS3(draftKey) → activo = última versión restante
```

Operaciones de mantenimiento:

- **Cambiar versión activa**: `POST /update-file` con la clave de cualquier Excel del historial.
- **Borrar una versión**: `POST /delete-file`. El activo se recalcula con la versión más reciente que quede (orden alfabético = cronológico gracias al formato de fecha). Si la provincia se queda vacía, se borra su activo.

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
