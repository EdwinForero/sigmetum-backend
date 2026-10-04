const jwt = require('jsonwebtoken');

const tokenAuth = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, error: 'No token provided' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            const expired = err.name === 'TokenExpiredError';
            return res.status(401).json({
                success: false,
                error: expired ? 'Token expired' : 'Invalid token',
            });
        }
        req.user = user;
        next();
    });
};

module.exports = { tokenAuth };
