const express = require('express');
const multer = require('multer');
const router = express.Router();

const { tokenAuth } = require('../functions/tokenAuthentication');
const { convertExcelToJson } = require('../functions/convertExcelToJson');
const { formatFileName } = require('../functions/formatFileName');
const { getNextVersion } = require('../functions/getNextVersion');
const {
    uploadFileToS3,
    getFileFromS3,
    getMergedDataInS3Folder,
    deleteFileFromS3,
    updateFileS3,
    listFilesInS3Folder,
} = require('../aws/awsS3connect');
const { BACKUP_FILES, USED_FILES } = require('../config/s3Paths');

const upload = multer({ storage: multer.memoryStorage() });

// --- Rutas públicas ---

router.get('/list-files', async (req, res, next) => {
    try {
        const files = await listFilesInS3Folder(BACKUP_FILES);
        res.json({ success: true, data: files });
    } catch (error) {
        next(error);
    }
});

router.get('/get-data/:path(*)', async (req, res, next) => {
    try {
        const jsonData = await getFileFromS3(req.params.path);
        res.json({ success: true, data: jsonData });
    } catch (error) {
        next(error);
    }
});

router.get('/get-merged-data', async (req, res, next) => {
    try {
        const jsonData = await getMergedDataInS3Folder(USED_FILES);
        res.json({ success: true, data: jsonData });
    } catch (error) {
        next(error);
    }
});

// --- Rutas protegidas ---

const protectedRouter = express.Router();
protectedRouter.use(tokenAuth);

protectedRouter.post('/upload', upload.single('file'), async (req, res, next) => {
    try {
        const { processedData, emptyFields } = await convertExcelToJson(req.file.buffer);

        if (emptyFields.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Some rows have empty fields.',
                data: {
                    emptyFields,
                    processedData,
                    actionRequired: 'Confirm whether to continue or cancel the upload.',
                },
            });
        }

        if (!processedData || !Array.isArray(processedData)) {
            throw new Error('Excel conversion failed. The data is not valid.');
        }

        const provincia = processedData[0]?.['Provincia'] || 'Desconocido';
        const { version, provinciaFolder } = await getNextVersion(provincia);
        const jsonBuffer = Buffer.from(JSON.stringify(processedData, null, 2), 'utf8');

        await uploadFileToS3(`${provincia}.json`, jsonBuffer, USED_FILES);
        await uploadFileToS3(formatFileName(provincia, '.json', version), jsonBuffer, provinciaFolder);

        res.json({ success: true, data: 'Files uploaded successfully' });
    } catch (error) {
        next(error);
    }
});

protectedRouter.post('/upload/confirm', async (req, res, next) => {
    try {
        const { confirmed, fileData } = req.body;

        if (!confirmed) {
            return res.status(400).json({ success: false, error: 'Upload cancelled by user.' });
        }

        const provincia = fileData[0]?.['Provincia'] || 'Desconocido';
        const { version, provinciaFolder } = await getNextVersion(provincia);
        const jsonBuffer = Buffer.from(JSON.stringify(fileData, null, 2), 'utf8');

        await uploadFileToS3(`${provincia}.json`, jsonBuffer, USED_FILES);
        await uploadFileToS3(formatFileName(provincia, '.json', version), jsonBuffer, provinciaFolder);

        res.json({ success: true, data: 'Files uploaded successfully after confirmation.' });
    } catch (error) {
        next(error);
    }
});

protectedRouter.post('/update-file', async (req, res, next) => {
    try {
        const { fileName } = req.body;
        const match = fileName.match(/\/([^/]+)\//);
        const folderName = match ? match[1] : null;
        await updateFileS3(fileName, folderName);
        res.json({ success: true, data: 'ok' });
    } catch (error) {
        next(error);
    }
});

protectedRouter.post('/delete-file', async (req, res, next) => {
    try {
        const { fileName } = req.body;
        await deleteFileFromS3(fileName);
        res.json({ success: true, data: 'ok' });
    } catch (error) {
        next(error);
    }
});

router.use(protectedRouter);

module.exports = router;
