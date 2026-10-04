const { listFilesInS3Folder } = require('../aws/awsS3connect');
const { DATA_PATH } = require('../config/s3Paths');

const getNextVersion = async (provincia) => {
    const provinciaFolder = `${DATA_PATH}/${provincia}`;
    const filesInFolder = await listFilesInS3Folder(provinciaFolder);

    const today = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'
    let version = 1;

    filesInFolder.forEach(file => {
        const match = file.name.match(/^(\d{4}-\d{2}-\d{2})_v(\d+)\.xlsx$/);
        if (match && match[1] === today) {
            const fileVersion = parseInt(match[2]);
            if (fileVersion >= version) version = fileVersion + 1;
        }
    });

    return { version, provinciaFolder };
};

module.exports = { getNextVersion };
