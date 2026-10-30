const { DATA_PATH, ACTIVE_PATH } = require('../config/s3Paths');
const { latestVersionFile } = require('./versionName');

// Reglas de la versión activa de una provincia (funciones puras: no leen S3, ni el reloj, ni el entorno).
// Las claves que reciben ya están validadas por las rutas (isValidDataKey).

// Carpeta de las versiones de una provincia: data/<provincia>.
const provinciaFolderOf = (provincia) => `${DATA_PATH}/${provincia}`;

// Clave del JSON activo de una provincia: data/active/<provincia>.json.
const activeKeyOf = (provincia) => `${ACTIVE_PATH}/${provincia}.json`;

// Provincia de la clave de una versión (data/<provincia>/<fecha>_v<n>.xlsx).
const provinciaOfKey = (filePath) => filePath.split('/')[1];

// Qué hacer con el activo tras borrar una versión, según lo que queda en la carpeta ([{ name, key }]):
// { action: 'regenerate', key } con la última versión estándar; { action: 'delete' } si no queda ningún .xlsx;
// { action: 'keep' } si quedan .xlsx pero ninguno con nombre estándar (el activo no se toca).
const planActiveAfterDelete = (remaining) => {
    const latest = latestVersionFile(remaining);
    if (latest) return { action: 'regenerate', key: latest.key };
    if (!remaining.some(f => f.name.endsWith('.xlsx'))) return { action: 'delete' };
    return { action: 'keep' };
};

module.exports = { provinciaFolderOf, activeKeyOf, provinciaOfKey, planActiveAfterDelete };
