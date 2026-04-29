require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const logger = require('./utils/logger');
const webhookRoutes = require('./routes/webhook.routes');
const authRoutes = require('./routes/auth.routes');
const transactionRoutes = require('./routes/transactions.routes');
const householdRoutes = require('./routes/household.routes');
const categoriesRoutes = require('./routes/categories.routes');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Security ────────────────────────────────────────────────────
app.use(helmet());

app.use(cors({
  origin: [process.env.FRONTEND_URL, 'http://localhost:3000'],
  credentials: true,
}));

// ── Rate limiting ───────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// ── Logging ─────────────────────────────────────────────────────
app.use(morgan('combined', {
  stream: { write: (message) => logger.info(message.trim()) },
}));

// ── Body parsing ────────────────────────────────────────────────
// Webhook de Meta requiere el body como JSON
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Routes ──────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'TusGastos Backend',
    timestamp: new Date().toISOString(),
  });
});

app.use('/webhook', webhookRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/household', householdRoutes);
app.use('/api/categories', categoriesRoutes);

// ── 404 ─────────────────────────────────────────────────────────
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// ── Error handler ───────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ── Start ────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`🚀 GestionAndo Backend corriendo en puerto ${PORT}`);
  logger.info(`📱 Webhook: POST /webhook`);
  logger.info(`🔐 Auth:    POST /api/auth/login`);
  logger.info(`💰 API:     GET  /api/transactions`);
});

module.exports = app;
