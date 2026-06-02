const { listFilesInS3Folder } = require('../aws/awsS3connect');
const { BACKUP_FILES } = require('../config/s3Paths');

const getNextVersion = async (provincia) => {
    const provinciaFolder = `${BACKUP_FILES}/${provincia}`;
    const filesInFolder = await listFilesInS3Folder(provinciaFolder);
    let version = 1;

    filesInFolder.forEach(file => {
        const match = file.name.match(/_V(\d+)_/);
        if (match) {
            const fileVersion = parseInt(match[1]);
            if (fileVersion >= version) version = fileVersion + 1;
        }
    });

    return { version, provinciaFolder };
};

module.exports = { getNextVersion };
