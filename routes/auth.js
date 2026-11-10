const express = require('express');
const router = express.Router();
const { tokenAuth } = require('../middleware/tokenAuthentication');

router.get('/auth', tokenAuth, (req, res) => {
    res.status(200).json({ success: true, data: 'Authorized' });
});

module.exports = router;
