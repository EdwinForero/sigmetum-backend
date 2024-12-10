const express = require('express');
const multer = require('multer');
const { convertExcelToJson } = require('../functions/convertExcelToJson');
const { formatFileName } = require('../functions/formatFileName');
const fs = require('fs');
const { uploadFileToS3 } = require('../aws/awsS3connect.js');
const { listFilesInS3Folder } = require('../aws/awsS3connect.js');
const path = require('path');
const { tokenAuth } = require('../functions/tokenAuthentication');

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

router.post('/upload', upload.single('file'), tokenAuth, async (req, res) => {
    try {
        const filePath = path.join(__dirname, '../uploads', req.file.filename);

        const { processedData, emptyFields } = convertExcelToJson(filePath);

        if (emptyFields.length > 0) {

            return res.status(400).json({
                message: 'Se detectaron campos vacíos en algunas filas.',
                emptyFields,
                processedData,
                actionRequired: 'Confirma si deseas continuar con el proceso o cancelar.'
            });
        }

        if (!processedData || !Array.isArray(processedData)) {
            throw new Error('La conversión a JSON falló. Los datos no son válidos.');
        }

        const provincia = processedData[0]?.["Provincia"] || "Desconocido";
        const provinciaFolder = `backupFiles/${provincia}`;

        const filesInFolder = await listFilesInS3Folder(provinciaFolder);
        let version = 1;

        filesInFolder.forEach(file => {
            const match = file.name.match(/_V(\d+)_/);
            if (match) {
                const fileVersion = parseInt(match[1]);
                if (fileVersion >= version) {
                    version = fileVersion + 1;
                }
            }
        });

        const backupFileName = formatFileName(provincia, ".json", version);
        const jsonFileName = `${provincia}.json`;

        const jsonString = JSON.stringify(processedData, null, 2);
        const jsonFilePath = path.join(__dirname, '../uploads', jsonFileName);
        fs.writeFileSync(jsonFilePath, jsonString, 'utf8');

        await uploadFileToS3(jsonFileName, jsonFilePath, `usedFiles`);
        await uploadFileToS3(backupFileName, jsonFilePath, provinciaFolder);

        fs.unlink(filePath, (err) => {
            if (err) console.error('Error al borrar el archivo temporal:', err);
        });
        fs.unlink(jsonFilePath, (err) => {
            if (err) console.error('Error al borrar el archivo JSON temporal:', err);
        });

        res.json({ message: 'Archivos subidos con éxito' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al procesar el archivo' });
    }
});

module.exports = router;