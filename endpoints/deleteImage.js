const express = require('express');
const router = express.Router();
const { tokenAuth } = require('../functions/tokenAuthentication');
const { deleteImageFromS3 } = require('../aws/awsS3connect.js');

router.delete('/delete-image', tokenAuth, async (req, res) => {
    const filePath = 'contentManagement/images/gallery';
    const { imageKey } = req.body;

  if (!imageKey) {
    return res.status(400).json({ error: 'Debe proporcionar la clave del archivo a eliminar' });
  }

  const result = await deleteImageFromS3(filePath, imageKey);

  if (result.success) {
    return res.status(200).json({ message: 'Archivo eliminado correctamente' });
  } else {
    return res.status(500).json({ error: result.error });
  }
});

module.exports = router;