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

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const errorHandler = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const dataRoutes = require('./routes/data');
const contentRoutes = require('./routes/content');

const app = express();
const PORT = process.env.PORT || 8000;

// 1 hop: ALB → nginx (loopback) → Express; tells express-rate-limit to read the real client IP from X-Forwarded-For
app.set('trust proxy', 1);

app.use('/healthcheck', (req, res) => {
    res.status(200).send('ok');
});

app.use(morgan('combined'));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN }));
app.use(express.json());
app.use(compression());

const API_PREFIX = process.env.API_PREFIX || '/api/v1';
app.use(API_PREFIX, authRoutes);
app.use(API_PREFIX, dataRoutes);
app.use(API_PREFIX, contentRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
    console.log(`Servidor corriendo en ${PORT}`);
});
