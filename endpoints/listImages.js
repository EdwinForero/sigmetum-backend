const express = require('express');
const router = express.Router();
const { getPresignedUrlsFromS3Folder } = require('../aws/awsS3connect.js');

router.get('/list-images', async (req, res) => {
  try {
    const folderPath = 'contentManagement/images/gallery';
    const urls = await getPresignedUrlsFromS3Folder(folderPath);

    res.json({ urls });
  } catch (error) {
    console.error('Error retrieving image URLs:', error);
    res.status(500).json({ error: 'Error retrieving image URLs' });
  }
});

module.exports = router;