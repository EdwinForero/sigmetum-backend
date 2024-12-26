const express = require('express');
const router = express.Router();
const { getPresignedUrlFromS3 } = require('../aws/awsS3connect.js');

router.get('/get-file', async (req, res) => {
  try {
    const filePath = 'contentManagement/files';
    const fileKey = req.query.fileKey;
    const fileUrl = await getPresignedUrlFromS3(filePath, fileKey);
    res.json({ fileUrl });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error retrieving file content' });
  }
});

module.exports = router;