const { DATA_PATH, ACTIVE_PATH, DRAFTS_PATH } = require('../config/s3Paths');
const { latestVersionFile } = require('./versionName');

// Reglas de la versión activa de una provincia (funciones puras: no leen S3, ni el reloj, ni el entorno).
// Las claves que reciben ya están validadas por las rutas (isValidDataKey).

// Carpeta de las versiones de una provincia: data/<provincia>.
const provinciaFolderOf = (provincia) => `${DATA_PATH}/${provincia}`;

// Clave del JSON activo de una provincia: data/active/<provincia>.json.
const activeKeyOf = (provincia) => `${ACTIVE_PATH}/${provincia}.json`;

// Provincia de la clave de una versión (data/<provincia>/<fecha>_v<n>.xlsx).
const provinciaOfKey = (filePath) => filePath.split('/')[1];

// Carpeta de los borradores de una provincia: data/drafts/<provincia>.
const draftFolderOf = (provincia) => `${DRAFTS_PATH}/${provincia}`;

// Clave de un borrador nuevo: data/drafts/<provincia>/<id>.xlsx. El id (UUID) lo inyecta la ruta para que siga siendo pura.
const newDraftKeyOf = (provincia, id) => `${draftFolderOf(provincia)}/${id}.xlsx`;

// Provincia de la clave de un borrador (data/drafts/<provincia>/<uuid>.xlsx).
const provinciaOfDraftKey = (draftKey) => draftKey.split('/')[2];

// Qué hacer con el activo tras borrar una versión, según lo que queda en la carpeta ([{ name, key }]):
// { action: 'regenerate', key } con la última versión estándar; { action: 'delete' } si no queda ningún .xlsx;
// { action: 'keep' } si quedan .xlsx pero ninguno con nombre estándar (el activo no se toca).
const planActiveAfterDelete = (remaining) => {
    const latest = latestVersionFile(remaining);
    if (latest) return { action: 'regenerate', key: latest.key };
    if (!remaining.some(f => f.name.endsWith('.xlsx'))) return { action: 'delete' };
    return { action: 'keep' };
};

module.exports = {
    provinciaFolderOf, activeKeyOf, provinciaOfKey, draftFolderOf, newDraftKeyOf, provinciaOfDraftKey, planActiveAfterDelete,
};
