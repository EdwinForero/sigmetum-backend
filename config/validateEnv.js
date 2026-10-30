const jwt = require('jsonwebtoken');

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

const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const MIN_JWT_SECRET_LENGTH = 32;
const ONLY_NUMBER = /^-?\d*\.?\d+$/;

// Un número sin unidad es inválido (jsonwebtoken lo leería como milisegundos). El resto lo valida jsonwebtoken
// al firmar, y se exige una duración mayor que cero.
function isValidExpiration(value) {
    if (ONLY_NUMBER.test(value)) return false;
    try {
        const decoded = jwt.decode(jwt.sign({}, 'x', { expiresIn: value }));
        return decoded.exp - decoded.iat > 0;
    } catch {
        return false;
    }
}

// Reglas de valor de las variables presentes. Los mensajes llevan el nombre de la variable y la regla, nunca el valor.
function invalidValues() {
    const problems = [];
    const { ADMIN_PASSWORD, JWT_SECRET, JWT_EXPIRATION } = process.env;
    if (ADMIN_PASSWORD && !BCRYPT_HASH.test(ADMIN_PASSWORD)) {
        problems.push('ADMIN_PASSWORD: debe ser un hash bcrypt completo');
    }
    if (JWT_SECRET && JWT_SECRET.length < MIN_JWT_SECRET_LENGTH) {
        problems.push(`JWT_SECRET: debe tener al menos ${MIN_JWT_SECRET_LENGTH} caracteres`);
    }
    if (JWT_EXPIRATION && !isValidExpiration(JWT_EXPIRATION)) {
        problems.push('JWT_EXPIRATION: debe ser una duración con unidad y mayor que cero (por ejemplo 8h)');
    }
    return problems;
}

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

    const problems = invalidValues();
    if (problems.length === 0) return;

    // Falla cerrado: solo 'local' y 'test' se conforman con un aviso.
    if (['local', 'test'].includes(process.env.NODE_ENV)) {
        problems.forEach(problem => console.warn(`[validateEnv] ${problem}`));
        return;
    }
    throw new Error(`Variables de entorno con valor no válido: ${problems.join('; ')}`);
}

module.exports = validateEnv;
