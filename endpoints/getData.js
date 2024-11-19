const express = require('express');
const router = express.Router();
const { getFileFromS3 } = require('../aws/awsS3connect.js');

router.get('/get-data/:path(*)', async (req, res) => {
    try {
        const filePath = req.params.path;
        const jsonData = await getFileFromS3(filePath);
        res.json(jsonData);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error retrieving file content' });
    }
});

module.exports = router;