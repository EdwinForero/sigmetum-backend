// Entorno ficticio de los tests. Se requiere el PRIMERO, antes de cargar ningún módulo del proyecto:
// no se lee .env, no hay credenciales reales y nada habla con la red.
const TEST_SECRET = 'solo-para-pruebas-no-es-un-secreto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = TEST_SECRET;
process.env.JWT_EXPIRATION = '1h';
process.env.ADMIN_USERNAME = 'admin-de-prueba';
process.env.ADMIN_PASSWORD = 'no-es-un-hash-real';
process.env.EMAIL = 'correo-de-prueba@example.com';
process.env.EMAIL_PASSWORD = 'solo-para-pruebas-no-es-un-secreto';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_BUCKET_NAME = 'bucket-de-prueba';
process.env.ALLOWED_ORIGIN = 'http://localhost';
delete process.env.API_PREFIX;

module.exports = { TEST_SECRET };
