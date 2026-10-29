const { DATA_PATH, DATA_FILE_NAME_PATTERN } = require('../config/s3Paths');
const { getProvinciaNameError } = require('./validateProvincia');

const DATA_KEY_MAX_LENGTH = 120;

// Lista de permitidos para la clave de una versión que llega del cliente (draftKey, fileName):
// data/{provincia}/AAAA-MM-DD_vN.xlsx. La clave no se normaliza ni se reescribe: si la provincia no está en NFC, se rechaza.
const isValidDataKey = (key) => {
    if (typeof key !== 'string' || key.length > DATA_KEY_MAX_LENGTH) return false;
    const segments = key.split('/');
    if (segments.length !== 3 || segments[0] !== DATA_PATH) return false;
    const [, provincia, fileName] = segments;
    if (getProvinciaNameError(provincia) !== null || provincia !== provincia.normalize('NFC')) return false;
    return DATA_FILE_NAME_PATTERN.test(fileName);
};

module.exports = { isValidDataKey };
