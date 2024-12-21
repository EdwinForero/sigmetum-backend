const express = require('express');
const router = express.Router();
const { getImageFromS3 } = require('../aws/awsS3connect.js');

router.get('/get-image', async (req, res) => {
  try {
    const imageKey = req.query.imageKey;
    const imageUrl = await getImageFromS3(imageKey);
    res.json({ imageUrl });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error retrieving file content' });
  }
});

module.exports = router;