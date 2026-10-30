const express = require('express');
const multer = require('multer');
const path = require('path');
const { randomUUID } = require('crypto');
const router = express.Router();

const { tokenAuth } = require('../middleware/tokenAuthentication');
const { convertExcelToJson } = require('../functions/convertExcelToJson');
const { formatFileName } = require('../functions/formatFileName');
const { getNextVersion } = require('../functions/getNextVersion');
const {
    provinciaFolderOf, activeKeyOf, provinciaOfKey, draftFolderOf, newDraftKeyOf, provinciaOfDraftKey, planActiveAfterDelete,
} = require('../functions/activeVersion');
const { validateProvincia } = require('../functions/validateProvincia');
const { isValidDataKey, isValidDraftKey } = require('../functions/validateDataKey');
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

// Deletes the drafts of a province (data/drafts/<provincia>/) except exceptKey. Only keys that pass isValidDraftKey are
// deleted (allow-list): anything else placed under the prefix by hand is left alone.
const discardDrafts = async (provincia, exceptKey) => {
    const drafts = await listFilesInS3Folder(draftFolderOf(provincia));
    for (const { key } of drafts) {
        if (key !== exceptKey && isValidDraftKey(key)) await deleteFileFromS3(key);
    }
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

        if (emptyFields.length > 0) {
            // Excel saved as a draft outside the versions (data/drafts/<provincia>/<uuid>.xlsx) — front decides whether to
            // confirm or cancel. The new draft replaces any previous draft of the province.
            const draftKey = newDraftKeyOf(provincia, randomUUID());
            await uploadFileToS3(path.basename(draftKey), req.file.buffer, draftFolderOf(provincia));
            await discardDrafts(provincia, draftKey);
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

        // No empty fields — store the Excel as the next version and activate immediately
        const now = new Date();
        const filesInFolder = await listFilesInS3Folder(provinciaFolderOf(provincia));
        const { version, provinciaFolder } = getNextVersion(provincia, filesInFolder, now);
        const xlsxFileName = formatFileName(version, now);
        const versionKey = `${provinciaFolder}/${xlsxFileName}`;
        await uploadFileToS3(xlsxFileName, req.file.buffer, provinciaFolder);

        const jsonBuffer = Buffer.from(JSON.stringify(processedData, null, 2), 'utf8');
        await uploadFileToS3(`${provincia}.json`, jsonBuffer, ACTIVE_PATH);

        // A complete upload makes any earlier draft obsolete: confirming it later would overwrite the active with older data.
        // Best effort: the upload is already done and active, so a failure here is logged and the client still gets a 200.
        try {
            await discardDrafts(provincia);
        } catch (discardError) {
            console.error('Error discarding previous drafts:', discardError);
        }

        res.json({ success: true, data: { message: 'Files uploaded successfully', key: versionKey } });
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

        if (!isValidDraftKey(draftKey)) {
            return res.status(400).json({ success: false, error: 'Invalid draftKey' });
        }

        // The province comes from the validated draftKey. Safe while only the server writes drafts (POST /upload derives
        // the province from the Excel with validateProvincia); it is not compared against the Excel content.
        const provincia = provinciaOfDraftKey(draftKey);

        // DeleteObject is idempotent, so existence is checked first: a draft already confirmed, cancelled or replaced is a 404.
        const drafts = await listFilesInS3Folder(draftFolderOf(provincia));
        if (!drafts.some(({ key }) => key === draftKey)) {
            return next(Object.assign(new Error('Draft not found'), { status: 404, publicMessage: 'Draft not found' }));
        }

        if (!confirmed) {
            // Cancel: only the draft goes away; versions and the active one are not touched
            await deleteFileFromS3(draftKey);
            return res.json({ success: true, data: 'Upload cancelled. Draft removed.' });
        }

        // Confirm: convert first (a bad Excel leaves no orphan version), then write the next version, the active json
        // from the already converted data, and finally delete the draft. If it is interrupted before the delete, the draft
        // stays and repeating the confirmation creates the next version with the same content.
        const buffer = await getBufferFromS3(draftKey);
        const { processedData } = await convertExcelToJson(buffer);
        const filesInFolder = await listFilesInS3Folder(provinciaFolderOf(provincia));
        const now = new Date();
        const { version, provinciaFolder } = getNextVersion(provincia, filesInFolder, now);
        await uploadFileToS3(formatFileName(version, now), buffer, provinciaFolder);
        await putJsonToS3(activeKeyOf(provincia), processedData);
        await deleteFileFromS3(draftKey);

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
