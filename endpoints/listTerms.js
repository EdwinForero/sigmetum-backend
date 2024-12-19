const express = require('express');
const router = express.Router();
const { getTextJsonS3 } = require('../aws/awsS3connect.js');

router.get('/list-terms', async (req, res) => {
    try {
        const folderName = 'contentManagement';
        const fileName = 'noLatinTerms.json';

        const terms = await getTextJsonS3(fileName, folderName);
        res.json({ success: true, terms });
    } catch (error) {
        console.error('Error al listar términos:', error);
        res.status(500).json({ success: false, message: 'Error al listar términos' });
    }
  });

module.exports = router;