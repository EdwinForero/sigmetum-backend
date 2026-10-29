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
const notFound = require('./middleware/notFound');

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
// Error constante (cors y errorHandler no lo mutan): evita capturar una pila por cada petición rechazada
const originNotAllowed = new Error('Origin not allowed');
originNotAllowed.status = 403;
originNotAllowed.publicMessage = 'Origin not allowed';

app.use(cors({
  origin: (origin, callback) => {
    const allowed = (process.env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('CORS: origin not allowed:', JSON.stringify(origin.slice(0, 200)));
      callback(originNotAllowed);
    }
  },
}));
app.use(express.json());
app.use(compression());

const API_PREFIX = process.env.API_PREFIX || '/api/v1';
app.use(API_PREFIX, authRoutes);
app.use(API_PREFIX, dataRoutes);
app.use(API_PREFIX, contentRoutes);

app.use(notFound);

app.use(errorHandler);

app.listen(PORT, () => {
    console.log(`Servidor corriendo en ${PORT}`);
});
