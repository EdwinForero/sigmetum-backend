const { IMAGE_KEY_MAX_LENGTH, IMAGE_KEY_PATTERN } = require('../config/s3Paths');

// Lista de permitidos para el imageKey que llega del cliente antes de construir una clave de S3.
// La longitud va primero, antes de ejecutar la expresión.
// La comprobación de ".." es defensa en profundidad: el patrón por segmentos no la garantiza por sí
// solo ("a../b.jpg", que es lo que llega tras decodificar "a%2e%2e/b.jpg", cumple el patrón).
const isValidImageKey = (key) => {
    if (typeof key !== 'string') return false;
    if (key.length < 1 || key.length > IMAGE_KEY_MAX_LENGTH) return false;
    if (!IMAGE_KEY_PATTERN.test(key)) return false;
    return !key.includes('..');
};

module.exports = { isValidImageKey };
