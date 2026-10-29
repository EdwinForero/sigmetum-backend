const { IMAGE_UPLOAD_TYPES, IMAGE_KEY_MAX_LENGTH } = require('../config/s3Paths');
const { isValidImageKey } = require('./validateImageKey');

// Validación de POST /upload-image. Función pura: no lee el entorno ni habla con S3.
// Devuelve { error } o { value: { key, contentType } }; key es relativa a GALLERY_PATH y contentType es el MIME
// canónico del tipo validado. Los mensajes de error son fijos y no reflejan el MIME, el título ni el nombre.
// Orden: tipo (extensión y MIME), título, firma del contenido.

const ERROR_TYPE = 'Image type not allowed';
const ERROR_TITLE = 'Image title is not valid';
const ERROR_CONTENT = 'File content does not match the image type';

const startsWith = (buffer, bytes) => buffer.subarray(0, bytes.length).equals(Buffer.from(bytes));

// Firma (magic bytes) del contenido según el tipo canónico. Un buffer más corto que la firma no coincide.
const hasSignature = (contentType, buffer) => {
    switch (contentType) {
        case 'image/jpeg':
            return startsWith(buffer, [0xff, 0xd8, 0xff]);
        case 'image/png':
            return startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        case 'image/gif': {
            const head = buffer.subarray(0, 6).toString('latin1');
            return head === 'GIF87a' || head === 'GIF89a';
        }
        case 'image/webp':
            return buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP';
        default:
            return false;
    }
};

// Extensión en minúsculas (lo que hay tras el último "."); vacía si no hay punto.
const getExtension = (originalName) => {
    const dot = originalName.lastIndexOf('.');
    return dot === -1 ? '' : originalName.slice(dot + 1).toLowerCase();
};

// Título saneado: recorte, blanco (\s+) a "_" y sin puntos finales. Devuelve '' si no es válido.
// La longitud se acota antes de quitar los puntos finales para no ejecutar la expresión sobre texto largo.
const sanitizeTitle = (title) => {
    const sanitized = title.trim().replace(/\s+/g, '_');
    if (sanitized.length > IMAGE_KEY_MAX_LENGTH) return '';
    return sanitized.replace(/\.+$/, '');
};

const validateImageUpload = ({ file, title }) => {
    const extension = getExtension(file.originalname);
    // Búsqueda sobre las entradas propias: "constructor" o "__proto__" no pasan y no hay acceso con índice variable
    // (evita un aviso security/detect-object-injection).
    const entry = Object.entries(IMAGE_UPLOAD_TYPES).find(([ext]) => ext === extension);
    if (!entry) return { error: ERROR_TYPE };
    const contentType = entry[1];
    if (String(file.mimetype).toLowerCase() !== contentType) return { error: ERROR_TYPE };

    const sanitizedTitle = sanitizeTitle(title);
    if (!sanitizedTitle || sanitizedTitle.includes('/') || sanitizedTitle.includes('\\')) return { error: ERROR_TITLE };
    const key = `${sanitizedTitle}.${extension}`;
    if (!isValidImageKey(key)) return { error: ERROR_TITLE };

    if (!hasSignature(contentType, file.buffer)) return { error: ERROR_CONTENT };

    return { value: { key, contentType } };
};

module.exports = { validateImageUpload };
