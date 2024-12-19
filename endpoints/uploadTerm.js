const express = require('express');
const { uploadTextToJsonS3 } = require('../aws/awsS3connect.js');
const { tokenAuth } = require('../functions/tokenAuthentication');
const router = express.Router();

router.post('/upload-term', tokenAuth, async (req, res) => {
  try {
    const { term } = req.body;
    if (!term || !term.trim()) {
      return res.status(400).json({ message: 'El término no puede estar vacío' });
    }

    const folderName = 'contentManagement';
    const fileName = 'noLatinTerms.json';

    const fileUrl = await uploadTextToJsonS3(term, fileName, folderName);

    res.status(200).json({
      success: true,
      message: 'Término agregado correctamente',
      fileUrl,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error al agregar el término',
      error: error.message,
    });
  }
});

module.exports = router;