const express = require('express');
const router = express.Router();
const { formatFileName } = require('../functions/formatFileName');
const { uploadFileToS3 } = require('../aws/awsS3connect.js');
const { listFilesInS3Folder } = require('../aws/awsS3connect.js');
const path = require('path');
const fs = require('fs');
const { tokenAuth } = require('../functions/tokenAuthentication');

router.post('/upload/confirm', tokenAuth, async (req, res) => {
    try {
        const { confirmed, fileData } = req.body;

        if (!confirmed) {
            return res.status(400).json({ message: 'El proceso fue cancelado por el usuario.' });
        }
        
        const provincia = fileData[0]?.["Provincia"] || "Desconocido";
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

        const jsonString = JSON.stringify(fileData, null, 2);
        const jsonFilePath = path.join(__dirname, '../uploads', jsonFileName);
        fs.writeFileSync(jsonFilePath, jsonString, 'utf8');

        await uploadFileToS3(jsonFileName, jsonFilePath, `usedFiles`);
        await uploadFileToS3(backupFileName, jsonFilePath, provinciaFolder);

        fs.unlink(jsonFilePath, (err) => {
            if (err) console.error('Error al borrar el archivo JSON temporal:', err);
        });

        res.json({ message: 'Archivos subidos con éxito después de la confirmación.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al completar el proceso.' });
    }
});

module.exports = router;