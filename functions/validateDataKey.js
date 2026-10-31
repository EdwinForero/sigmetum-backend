const { DATA_PATH, ACTIVE_PATH, DRAFTS_PATH, DATA_FILE_NAME_PATTERN, DRAFT_FILE_NAME_PATTERN } = require('../config/s3Paths');
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

// Lista de permitidos para la clave de un borrador (draftKey de POST /upload/confirm):
// data/drafts/{provincia}/<uuid en minúsculas>.xlsx. Misma regla de provincia que isValidDataKey (sin normalizar).
const isValidDraftKey = (key) => {
    if (typeof key !== 'string' || key.length > DATA_KEY_MAX_LENGTH) return false;
    const segments = key.split('/');
    if (segments.length !== 4 || `${segments[0]}/${segments[1]}` !== DRAFTS_PATH) return false;
    const [, , provincia, fileName] = segments;
    if (getProvinciaNameError(provincia) !== null || provincia !== provincia.normalize('NFC')) return false;
    return DRAFT_FILE_NAME_PATTERN.test(fileName);
};

// JSON activo: data/active/{provincia}.json, con la misma regla de provincia (sin normalizar). Solo lo usa GET /get-data.
const isValidActiveKey = (key) => {
    if (typeof key !== 'string' || key.length > DATA_KEY_MAX_LENGTH) return false;
    const segments = key.split('/');
    if (segments.length !== 3 || `${segments[0]}/${segments[1]}` !== ACTIVE_PATH) return false;
    const fileName = segments[2];
    if (!fileName.endsWith('.json')) return false;
    const provincia = fileName.slice(0, -'.json'.length);
    return getProvinciaNameError(provincia) === null && provincia === provincia.normalize('NFC');
};

// Lista de permitidos de GET /get-data: una versión .xlsx o un JSON activo. Nada más (ni data/terms ni data/drafts).
const isValidGetDataKey = (key) => isValidDataKey(key) || isValidActiveKey(key);

module.exports = { isValidDataKey, isValidDraftKey, isValidGetDataKey };
