const express = require('express');
const router = express.Router();
const { deleteFileFromS3 } = require('../aws/awsS3connect.js');
const { tokenAuth } = require('../functions/tokenAuthentication');

router.post('/delete-file', tokenAuth, async (req, res) => {
    try {
        const { fileName } = req.body;
        await deleteFileFromS3(fileName);
        res.json("ok");
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error retrieving file content' });
    }
});

module.exports = router;