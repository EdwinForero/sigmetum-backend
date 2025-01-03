const express = require('express');
const router = express.Router();
const { updateFileS3 } = require('../aws/awsS3connect.js');
const { tokenAuth } = require('../functions/tokenAuthentication');

router.post('/update-file', tokenAuth, async (req, res) => {
    try {
        const { fileName } = req.body;
        const match = fileName.match(/\/([^/]+)\//);
        const folderName = match ? match[1] : null;

        await updateFileS3(fileName, folderName);
        res.json("ok");
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error retrieving file content' });
    }
});

module.exports = router;