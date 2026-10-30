const isDev = process.env.NODE_ENV === 'local';

// El error del SDK de S3 lleva "NoSuchKey" en name y, normalmente, en Code; solo name está garantizado.
// Detección equivalente a la de getTextJsonS3 (aws/awsS3connect.js): si cambia una, revisa la otra.
const isNoSuchKey = (err) => err.name === 'NoSuchKey' || err.Code === 'NoSuchKey';

const friendlyMessage = (err, status) => {
    const name = err.name || '';
    const code = err.Code || err.code || '';

    if (err.publicMessage) return err.publicMessage;
    if (name === 'TokenExpiredError') return 'Token expired';
    if (name === 'JsonWebTokenError') return 'Invalid token';
    if (name === 'MulterError' && code === 'LIMIT_FILE_SIZE') return 'File exceeds the maximum allowed size';
    if (name === 'MulterError') return `File upload error: ${err.message}`;
    if (isNoSuchKey(err) || code === 'NoSuchKey') return 'The requested file does not exist in storage';
    if (code === 'NoSuchBucket') return 'Storage bucket is not configured correctly';
    if (code === 'AccessDenied') return 'Access denied to storage';
    if (code === 'NetworkingError' || code === 'ECONNREFUSED') return 'Storage connection error';

    if (err.type === 'entity.parse.failed') return 'Invalid JSON';
    if (status === 413) return 'Payload too large';
    if (status >= 400 && status < 500) return 'Bad request';

    return 'Internal server error';
};

const errorHandler = (err, req, res, next) => {
    const status = err.status || err.statusCode || (err.name === 'MulterError' ? 400 : isNoSuchKey(err) ? 404 : 500);
    const message = friendlyMessage(err, status);

    if (isDev) {
        console.error(`[${req.method}] ${req.path} → ${status}:`, err.stack || err.message);
    } else {
        console.error(`[${req.method}] ${req.path} → ${status}: ${err.message}`);
    }

    res.status(status).json({ success: false, error: message });
};

module.exports = errorHandler;
