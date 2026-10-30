const { provinciaFolderOf } = require('./activeVersion');
const { parseVersionName } = require('./versionName');

// Recibe el listado de la carpeta de la provincia (filesInFolder: [{ name, key }]); no accede a S3.
const getNextVersion = (provincia, filesInFolder, now = new Date()) => {
    const provinciaFolder = provinciaFolderOf(provincia);

    const today = now.toISOString().slice(0, 10); // 'YYYY-MM-DD' en UTC
    let version = 1;

    filesInFolder.forEach(file => {
        const parsed = parseVersionName(file.name);
        if (parsed && parsed.date === today && parsed.version >= version) version = parsed.version + 1;
    });

    return { version, provinciaFolder };
};

module.exports = { getNextVersion };
