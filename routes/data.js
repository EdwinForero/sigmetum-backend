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
const { DATA_PATH, ACTIVE_PATH, RESERVED_SEGMENTS } = require('../config/s3Paths');

const upload = multer({ storage: multer.memoryStorage() });

// ─── Public routes ───────────────────────────────────────────────────────────

router.get('/list-files', async (req, res, next) => {
    try {
        const allFiles = await listFilesInS3Folder(`${DATA_PATH}/`);

        const grouped = {};
        allFiles.forEach(file => {
            // file.key = 'data/malaga/2024-01-15_v1.xlsx'
            const segments = file.key.split('/');
            const provincia = segments[1];
            if (!RESERVED_SEGMENTS.includes(provincia)) {
                if (!grouped[provincia]) grouped[provincia] = [];
                grouped[provincia].push({ name: file.name, key: file.key });
            }
        });

        res.json({ success: true, data: grouped });
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
        const jsonData = await getMergedDataInS3Folder(ACTIVE_PATH);
        res.json({ success: true, data: jsonData });
    } catch (error) {
        next(error);
    }
});

// ─── Protected routes ────────────────────────────────────────────────────────

const protectedRouter = express.Router();
protectedRouter.use(tokenAuth);

protectedRouter.post('/upload', upload.single('file'), async (req, res, next) => {
    try {
        const { processedData, emptyFields } = await convertExcelToJson(req.file.buffer);

        if (!processedData || !Array.isArray(processedData)) {
            throw new Error('Excel conversion failed. The data is not valid.');
        }

        const provincia = processedData[0]?.['Provincia'] || 'Desconocido';
        const { version, provinciaFolder } = await getNextVersion(provincia);
        const xlsxFileName = formatFileName(version);
        const draftKey = `${provinciaFolder}/${xlsxFileName}`;

        // Always store the original Excel
        await uploadFileToS3(xlsxFileName, req.file.buffer, provinciaFolder);

        if (emptyFields.length > 0) {
            // Excel saved as draft — front decides whether to confirm or cancel
            return res.status(400).json({
                success: false,
                error: 'Some rows have empty fields.',
                data: {
                    emptyFields,
                    processedData,
                    draftKey,
                    actionRequired: 'Confirm whether to continue or cancel the upload.',
                },
            });
        }

        // No empty fields — activate immediately
        const jsonBuffer = Buffer.from(JSON.stringify(processedData, null, 2), 'utf8');
        await uploadFileToS3(`${provincia}.json`, jsonBuffer, ACTIVE_PATH);

        res.json({ success: true, data: { message: 'Files uploaded successfully', key: draftKey } });
    } catch (error) {
        next(error);
    }
});

protectedRouter.post('/upload/confirm', async (req, res, next) => {
    try {
        const { confirmed, draftKey } = req.body;

        if (!draftKey) {
            return res.status(400).json({ success: false, error: 'draftKey is required' });
        }

        if (!confirmed) {
            // Cancel: delete the draft Excel from S3
            await deleteFileFromS3(draftKey);
            return res.json({ success: true, data: 'Upload cancelled. Draft removed.' });
        }

        // Confirm: activate the draft (read xlsx → convert → write active json)
        await updateFileS3(draftKey);

        res.json({ success: true, data: 'Files uploaded successfully after confirmation.' });
    } catch (error) {
        next(error);
    }
});

protectedRouter.post('/update-file', async (req, res, next) => {
    try {
        const { fileName } = req.body;
        await updateFileS3(fileName);
        res.json({ success: true, data: 'Active version updated successfully.' });
    } catch (error) {
        next(error);
    }
});

protectedRouter.post('/delete-file', async (req, res, next) => {
    try {
        const { fileName } = req.body;
        await deleteFileFromS3(fileName);
        res.json({ success: true, data: 'File deleted successfully.' });
    } catch (error) {
        next(error);
    }
});

router.use(protectedRouter);

module.exports = router;
