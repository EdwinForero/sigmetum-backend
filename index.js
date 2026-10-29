require('dotenv').config();

process.on('uncaughtException', (err) => {
    console.error('uncaughtException:', err.message);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error('unhandledRejection:', reason);
});

const validateEnv = require('./config/validateEnv');
validateEnv();

// app.js se carga después de validateEnv(): aws/awsS3connect.js lee AWS_REGION al cargarse
const app = require('./app');

const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
    console.log(`Servidor corriendo en ${PORT}`);
});
