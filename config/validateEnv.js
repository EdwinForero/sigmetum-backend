const { resolveTrustProxyHops, LENIENT_ENVS } = require('./trustProxy');

const required = [
    'COGNITO_USER_POOL_ID',
    'EMAIL',
    'EMAIL_PASSWORD',
    'AWS_REGION',
    'AWS_BUCKET_NAME',
    'ALLOWED_ORIGIN',
];

const requiredLocal = ['AWS_PROFILE'];

// Misma regla que aws-jwt-verify (CognitoJwtVerifier.USER_POOL_ID_REGEX): un solo dígito de región y prefijo eusc- admitido.
// Si el verificador se construyera con otro formato, fallaría en cada petición con un 401 silencioso.
const USER_POOL_ID = /^((?:eusc-[a-z]{2}|[a-z]{2})-(gov-)?[a-z]+-\d)_[a-zA-Z0-9]+$/;

// Problema de COGNITO_USER_POOL_ID (formato o región distinta de AWS_REGION) o null. Los mensajes llevan el nombre de
// la variable y la regla, nunca el valor.
function poolProblem() {
    const match = USER_POOL_ID.exec(process.env.COGNITO_USER_POOL_ID);
    if (!match) return 'COGNITO_USER_POOL_ID: debe tener la forma <región>_<identificador> (región de AWS, guion bajo e identificador alfanumérico)';
    if (match[1] !== process.env.AWS_REGION) return 'COGNITO_USER_POOL_ID: la región del pool debe coincidir con AWS_REGION';
    return null;
}

// Reglas de valor de las variables presentes que admiten el aviso en 'local' y 'test'.
function invalidValues() {
    const problems = [];
    const { problem } = resolveTrustProxyHops();
    if (problem) problems.push(problem);
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
    const pool = poolProblem();

    // El pool de Cognito falla cerrado en todo entorno: sin pool válido no se puede verificar ningún token.
    if (pool) throw new Error(`Variables de entorno con valor no válido: ${[pool, ...problems].join('; ')}`);

    if (problems.length === 0) return;

    // Falla cerrado: solo 'local' y 'test' se conforman con un aviso.
    if (LENIENT_ENVS.includes(process.env.NODE_ENV)) {
        problems.forEach(problem => console.warn(`[validateEnv] ${problem}`));
        return;
    }
    throw new Error(`Variables de entorno con valor no válido: ${problems.join('; ')}`);
}

module.exports = validateEnv;
