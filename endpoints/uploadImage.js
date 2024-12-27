const express = require('express');
const multer = require('multer');
const { tokenAuth } = require('../functions/tokenAuthentication');
const { uploadImageToS3 } = require('../aws/awsS3connect.js');

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({ storage });

router.post('/upload-image', upload.single('file'), tokenAuth, async (req, res) => {
  try {
    const file = req.file;
    const title = req.body.title;

    if (!file || !title) {
      return res.status(400).json({ message: 'Faltan el archivo o el título' });
    }

    const filePath = 'contentManagement/images/gallery';

    const sanitizedTitle = title.replace(/\s+/g, '_');

    const fileExtension = file.originalname.substring(file.originalname.lastIndexOf('.'));

    const fileKey = `${sanitizedTitle}${fileExtension}`;

    const result = await uploadImageToS3(file, filePath, fileKey);

    res.status(200).json({ message: 'Imagen subida con éxito', data: result });
  } catch (error) {
    console.error('Error al subir la imagen:', error);
    res.status(500).json({ message: 'Error al subir la imagen', error });
  }
});

module.exports = router;