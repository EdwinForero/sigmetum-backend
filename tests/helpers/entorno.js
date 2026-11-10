// Entorno ficticio de los tests. Se requiere el PRIMERO, antes de cargar ningún módulo del proyecto:
// no se lee .env, no hay credenciales reales y nada habla con la red.
process.env.NODE_ENV = 'test';
process.env.COGNITO_USER_POOL_ID = 'us-east-1_TestPool1';
process.env.EMAIL = 'correo-de-prueba@example.com';
process.env.EMAIL_PASSWORD = 'solo-para-pruebas-no-es-un-secreto';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_BUCKET_NAME = 'bucket-de-prueba';
process.env.ALLOWED_ORIGIN = 'http://localhost';
delete process.env.API_PREFIX;
delete process.env.TRUST_PROXY_HOPS;
