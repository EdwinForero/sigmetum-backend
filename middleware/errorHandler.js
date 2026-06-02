const isDev = process.env.NODE_ENV === 'local';

const friendlyMessage = (err) => {
    const name = err.name || '';
    const code = err.Code || err.code || '';

    if (name === 'TokenExpiredError') return 'Token expired';
    if (name === 'JsonWebTokenError') return 'Invalid token';
    if (name === 'MulterError') return `File upload error: ${err.message}`;
    if (code === 'NoSuchKey') return 'The requested file does not exist in storage';
    if (code === 'NoSuchBucket') return 'Storage bucket is not configured correctly';
    if (code === 'AccessDenied') return 'Access denied to storage';
    if (code === 'NetworkingError' || code === 'ECONNREFUSED') return 'Storage connection error';

    return err.message || 'Internal server error';
};

const errorHandler = (err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    const message = friendlyMessage(err);

    if (isDev) {
        console.error(`[${req.method}] ${req.path} → ${status}:`, err.stack || err.message);
    } else {
        console.error(`[${req.method}] ${req.path} → ${status}: ${err.message}`);
    }

    res.status(status).json({ success: false, error: message });
};

module.exports = errorHandler;
