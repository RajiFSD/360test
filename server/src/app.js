const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const config = require('./config');
const db = require('./db');
const openapi = require('./docs/openapi');
const { notFoundHandler, errorHandler } = require('./middleware/error');

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // uploads are displayed by the web app on another origin
      contentSecurityPolicy: false, // API only (+ Swagger UI, which needs inline scripts)
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin) || config.corsOrigins.includes('*')),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  if (!config.isTest) app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));

  // General API rate limit (login has its own stricter limiter).
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: config.isTest ? 100000 : 600,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }),
    }),
  );

  app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d', index: false }));

  app.get('/api/health', async (req, res) => {
    let dbOk = false;
    try {
      await db.query('SELECT 1');
      dbOk = true;
    } catch {
      dbOk = false;
    }
    res.status(dbOk ? 200 : 503).json({ data: { ok: dbOk, db: dbOk, time: new Date().toISOString() } });
  });

  app.get('/api/docs.json', (req, res) => res.json(openapi));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'SmartOutpass API' }));

  app.use('/api/auth', require('./routes/auth.routes'));
  app.use('/api/users', require('./routes/users.routes'));
  app.use('/api/outpasses', require('./routes/outpass.routes'));
  app.use('/api/trips', require('./routes/trips.routes'));
  app.use('/api/gate', require('./routes/gate.routes'));
  app.use('/api/geofences', require('./routes/geofence.routes'));
  app.use('/api/dashboard', require('./routes/dashboard.routes'));
  app.use('/api/reports', require('./routes/reports.routes'));
  app.use('/api/admin/import', require('./routes/import.routes'));
  app.use('/api/admin', require('./routes/admin.routes'));
  app.use('/api/ai', require('./routes/ai.routes'));
  app.use('/api', require('./routes/misc.routes'));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
