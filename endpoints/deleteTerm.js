const express = require('express');
const router = express.Router();
const { tokenAuth } = require('../functions/tokenAuthentication');
const { deleteTermFromS3 } = require('../aws/awsS3connect.js');

router.delete('/delete-term', tokenAuth, async (req, res) => {
    const { term } = req.body;
    const folderName = 'contentManagement';
    const fileName = 'noLatinTerms.json';
  
    if (!term) {
      return res.status(400).json({ success: false, message: 'Término requerido' });
    }
  
    try {
      const result = await deleteTermFromS3(term, fileName, folderName);
      if (result.success) {
        res.json({ success: true });
      } else {
        res.status(500).json({ success: false, message: result.message });
      }
    } catch (error) {
      res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
  });

  module.exports = router;