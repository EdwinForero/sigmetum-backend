exports.GALLERY_PATH = 'gallery';
exports.DATA_PATH = 'data';
exports.ACTIVE_PATH = 'data/active';
exports.TERMS_PATH = 'data/terms';
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

// Folder segments reserved inside DATA_PATH — excluded from /list-files grouping
exports.RESERVED_SEGMENTS = ['active', 'terms'];
