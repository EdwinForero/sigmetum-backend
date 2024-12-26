const express = require('express');
const router = express.Router();
const { getPresignedUrlFromS3 } = require('../aws/awsS3connect.js');

router.get('/get-image', async (req, res) => {
  try {
    const filePath = 'contentManagement/images';
    const imageKey = req.query.imageKey;
    const imageUrl = await getPresignedUrlFromS3(filePath, imageKey);
    res.json({ imageUrl });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error retrieving file content' });
  }
});

module.exports = router;