const { listFilesInS3Folder } = require('../aws/awsS3connect');
const { DATA_PATH } = require('../config/s3Paths');
const { parseVersionName } = require('./versionName');

const getNextVersion = async (provincia, now = new Date()) => {
    const provinciaFolder = `${DATA_PATH}/${provincia}`;
    const filesInFolder = await listFilesInS3Folder(provinciaFolder);

    const today = now.toISOString().slice(0, 10); // 'YYYY-MM-DD' en UTC
    let version = 1;

    filesInFolder.forEach(file => {
        const parsed = parseVersionName(file.name);
        if (parsed && parsed.date === today && parsed.version >= version) version = parsed.version + 1;
    });

    return { version, provinciaFolder };
};

module.exports = { getNextVersion };
