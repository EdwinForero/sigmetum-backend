const express = require('express');
const multer = require('multer');
const path = require('path');
const router = express.Router();

const { tokenAuth } = require('../functions/tokenAuthentication');
const { convertExcelToJson } = require('../functions/convertExcelToJson');
const { formatFileName } = require('../functions/formatFileName');
const { getNextVersion } = require('../functions/getNextVersion');
const { provinciaFolderOf, activeKeyOf, provinciaOfKey, planActiveAfterDelete } = require('../functions/activeVersion');
const { validateProvincia } = require('../functions/validateProvincia');
const { isValidDataKey } = require('../functions/validateDataKey');
const {
    uploadFileToS3,
    getFileFromS3,
    getMergedDataInS3Folder,
    getBufferFromS3,
    putJsonToS3,
    deleteFileFromS3,
    listFilesInS3Folder,
} = require('../aws/awsS3connect');
const { DATA_PATH, ACTIVE_PATH, RESERVED_SEGMENTS } = require('../config/s3Paths');

// Maximum accepted file size. multer rejects a size equal to fileSize, so 1 is added to accept exactly the maximum.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES + 1 } });

// ─── Active version orchestration ────────────────────────────────────────────

// Makes sourceKey (an .xlsx version) the active one: read xlsx → convert → write data/active/<provincia>.json.
const activateFrom = async (sourceKey, provincia) => {
    const buffer = await getBufferFromS3(sourceKey);
    const { processedData } = await convertExcelToJson(buffer);
    await putJsonToS3(activeKeyOf(provincia), processedData);
};

// Deletes a version and then fixes the active one according to what is left in the province folder.
const removeVersion = async (key) => {
    const provincia = provinciaOfKey(key);
    await deleteFileFromS3(key);
    const remaining = await listFilesInS3Folder(provinciaFolderOf(provincia));
    const plan = planActiveAfterDelete(remaining);
    if (plan.action === 'regenerate') await activateFrom(plan.key, provincia);
    else if (plan.action === 'delete') await deleteFileFromS3(activeKeyOf(provincia));
};

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

router.post('/upload', tokenAuth, upload.single('file'), async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'File is required' });
        }

        // The client sends the MIME type, so it is not checked; the extension is the real check.
        const isXlsx = path.extname(req.file.originalname).toLowerCase() === '.xlsx';
        if (!isXlsx) {
            return res.status(400).json({ success: false, error: 'Only .xlsx files are allowed' });
        }

        const { processedData, emptyFields } = await convertExcelToJson(req.file.buffer);

        if (!processedData || !Array.isArray(processedData)) {
            throw new Error('Excel conversion failed. The data is not valid.');
        }

        const { provincia, error: provinciaError } = validateProvincia(processedData);
        if (provinciaError) {
            return res.status(400).json({ success: false, error: provinciaError });
        }

        const now = new Date();
        const filesInFolder = await listFilesInS3Folder(provinciaFolderOf(provincia));
        const { version, provinciaFolder } = getNextVersion(provincia, filesInFolder, now);
        const xlsxFileName = formatFileName(version, now);
        const draftKey = `${provinciaFolder}/${xlsxFileName}`;

        // Always store the original Excel
        await uploadFileToS3(xlsxFileName, req.file.buffer, provinciaFolder);

        if (emptyFields.length > 0) {
            // Excel saved as draft — front decides whether to confirm or cancel
            return res.status(400).json({
                success: false,
                error: 'Some rows have empty fields.',
                data: {
                    emptyFields: emptyFields.map(({ rowIndex }) => ({ rowIndex })),
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

router.post('/upload/confirm', tokenAuth, async (req, res, next) => {
    try {
        const { confirmed, draftKey } = req.body;

        if (typeof draftKey !== 'string' || !draftKey) {
            return res.status(400).json({ success: false, error: 'draftKey is required' });
        }

        if (!isValidDataKey(draftKey)) {
            return res.status(400).json({ success: false, error: 'Invalid draftKey' });
        }

        if (!confirmed) {
            // Cancel: delete the draft Excel from S3
            await removeVersion(draftKey);
            return res.json({ success: true, data: 'Upload cancelled. Draft removed.' });
        }

        // Confirm: activate the draft (read xlsx → convert → write active json)
        await activateFrom(draftKey, provinciaOfKey(draftKey));

        res.json({ success: true, data: 'Files uploaded successfully after confirmation.' });
    } catch (error) {
        next(error);
    }
});

router.post('/update-file', tokenAuth, async (req, res, next) => {
    try {
        const { fileName } = req.body;
        if (typeof fileName !== 'string' || !fileName) {
            return res.status(400).json({ success: false, error: 'fileName is required' });
        }

        if (!isValidDataKey(fileName)) {
            return res.status(400).json({ success: false, error: 'Invalid fileName' });
        }

        await activateFrom(fileName, provinciaOfKey(fileName));
        res.json({ success: true, data: 'Active version updated successfully.' });
    } catch (error) {
        next(error);
    }
});

router.post('/delete-file', tokenAuth, async (req, res, next) => {
    try {
        const { fileName } = req.body;
        if (typeof fileName !== 'string' || !fileName) {
            return res.status(400).json({ success: false, error: 'fileName is required' });
        }

        if (!isValidDataKey(fileName)) {
            return res.status(400).json({ success: false, error: 'Invalid fileName' });
        }

        await removeVersion(fileName);
        res.json({ success: true, data: 'File deleted successfully.' });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
