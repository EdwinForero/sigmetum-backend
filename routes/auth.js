const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { userAuth } = require('../functions/userAuthentication');
const { tokenAuth } = require('../functions/tokenAuthentication');

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, error: 'Too many login attempts. Please try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});

router.post('/log', loginLimiter, userAuth);

router.get('/auth', tokenAuth, (req, res) => {
    res.status(200).json({ success: true, data: 'Authorized' });
});

module.exports = router;
