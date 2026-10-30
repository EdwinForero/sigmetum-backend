exports.GALLERY_PATH = 'gallery';
exports.DATA_PATH = 'data';
exports.ACTIVE_PATH = 'data/active';
exports.TERMS_PATH = 'data/terms';
// Borradores de POST /upload con celdas vacías: data/drafts/<provincia>/<uuid>.xlsx (no son versiones: A2 y A9).
exports.DRAFTS_PATH = 'data/drafts';
exports.TERMS_FILE = 'noLatinTerms.json';

// imageKey (GET /get-image, DELETE /delete-image): ruta relativa a GALLERY_PATH, sin texto libre.
// Uno o más segmentos separados por un único "/". Cada segmento empieza por una letra o número Unicode
// o por uno de _ - ( ) + (nunca por "." ni por una marca combinante) y sigue con letras, marcas combinantes
// \p{M} (nombres NFD, p. ej. de macOS), números y los signos . _ - ( ) +.
// Rechaza "/" inicial (el primer carácter no puede ser "/"), "//" y "/." o "/" + marca (segmento que empieza
// por "." o por una marca), barra invertida, espacios y caracteres de control. Forma plana con lookaheads
// para evitar repeticiones anidadas.
// Extensiones: las del selector del panel (jpg, jpeg, png, gif, webp; gif porque el frontend lo acepta).
// Sin bandera "g": test() no debe guardar estado entre llamadas.
exports.IMAGE_KEY_MAX_LENGTH = 200;
exports.IMAGE_KEY_PATTERN = /^(?!.*\/\/)(?!.*\/[.\p{M}])[\p{L}\p{N}_\-()+][\p{L}\p{M}\p{N}._\-()+/]*\.(?:jpe?g|png|gif|webp)$/iu;

// Tipos de imagen que acepta POST /upload-image: extensión (en minúsculas) -> MIME canónico, que es también el
// ContentType con el que se guarda el objeto. Consultar solo por sus entradas propias. Sus claves deben seguir siendo un
// subconjunto de las extensiones de IMAGE_KEY_PATTERN.
exports.IMAGE_UPLOAD_TYPES = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
};

// Provincia (POST /upload, carpeta data/{provincia}/): se valida tras recortar y normalizar a NFC.
// Se parte por espacio o guion y cada palabra debe cumplir PROVINCIA_WORD_PATTERN (letras latinas con diacríticos
// combinantes U+0300-U+036F, salvo U+034F y U+0345; cirílico, griego y otros alfabetos se rechazan, M23); una parte
// vacía (separador en los extremos o doble) se rechaza. Rechaza "/", "\", ".", dígitos.
// Longitud máxima antes de ejecutar la expresión.
// PROVINCIA_RESERVED: nombres que no pueden ser carpeta de provincia (RESERVED_SEGMENTS, que incluye drafts). Además
// se rechaza todo nombre que en minúsculas empiece por "active" o "terms" y los nombres de propiedades de objeto.
// DATA_FILE_NAME_PATTERN: nombre de archivo de una versión (AAAA-MM-DD_vN.xlsx), contrato con el frontend (D2).
// Fuente única del nombre de versión (la usan isValidDataKey y functions/versionName.js); grupos: 1 = fecha, 2 = N.
// Sin bandera "g": test() y match() no deben guardar estado entre llamadas.
exports.PROVINCIA_MAX_LENGTH = 50;
exports.PROVINCIA_WORD_PATTERN = /^(?=\p{L})\p{Script=Latin}(?:(?=\p{L})\p{Script=Latin}|[\u0300-\u0344\u0346-\u034E\u0350-\u036F])*$/u;
exports.DATA_FILE_NAME_PATTERN = /^(\d{4}-\d{2}-\d{2})_v(\d+)\.xlsx$/;

// Folder segments reserved inside DATA_PATH — excluded from /list-files grouping
exports.RESERVED_SEGMENTS = ['active', 'terms', 'drafts'];
exports.PROVINCIA_RESERVED = [...exports.RESERVED_SEGMENTS];

// Nombre de archivo de un borrador: <uuid en minúsculas>.xlsx (lo genera el servidor con crypto.randomUUID()).
// Sin bandera "g": test() no debe guardar estado entre llamadas.
exports.DRAFT_FILE_NAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.xlsx$/;
