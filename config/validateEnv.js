const required = [
    'JWT_SECRET',
    'JWT_EXPIRATION',
    'ADMIN_USERNAME',
    'ADMIN_PASSWORD',
    'EMAIL',
    'EMAIL_PASSWORD',
    'AWS_REGION',
    'AWS_BUCKET_NAME',
    'ALLOWED_ORIGIN',
];

const requiredLocal = ['AWS_PROFILE'];

function validateEnv() {
    const missing = required.filter(key => !process.env[key]);

    if (process.env.NODE_ENV === 'local') {
        requiredLocal.forEach(key => {
            if (!process.env[key]) missing.push(key);
        });
    }

    if (missing.length > 0) {
        throw new Error(`Variables de entorno requeridas no definidas: ${missing.join(', ')}`);
    }
}

module.exports = validateEnv;
