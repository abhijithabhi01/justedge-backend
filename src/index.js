import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { connectDB, isDbReady } from './config/db.js';
import demoRoutes from './routes/demoRoutes.js';
import { startDemoSensorSimulator } from './services/demoSensorSimulator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;

const DB_STATES = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };

// Transient Atlas / DNS / network errors must not kill the process.
// Mongoose will keep retrying; nodemon would otherwise sit on "app crashed".
function isTransientMongoError(err) {
  if (!err) return false;
  const msg = String(err.message || err);
  const name = String(err.name || '');
  return (
    name === 'MongoServerSelectionError' ||
    name === 'MongoNetworkError' ||
    name === 'MongoNetworkTimeoutError' ||
    name === 'MongoTimeoutError' ||
    /ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ReplicaSetNoPrimary|server selection timed out/i.test(
      msg
    )
  );
}

function isBenignMongoError(err) {
  if (!err) return false;
  // Duplicate key (E11000) should be handled in controllers; if it leaks, don't crash.
  if (err.code === 11000) return true;
  return /duplicate key/i.test(String(err.message || ''));
}

process.on('unhandledRejection', (reason) => {
  if (isTransientMongoError(reason) || isBenignMongoError(reason)) {
    console.error('[process] handled rejection (ignored):', reason?.message || reason);
    return;
  }
  console.error('[process] unhandledRejection:', reason);
});

process.on('uncaughtException', (err) => {
  if (isTransientMongoError(err) || isBenignMongoError(err)) {
    console.error('[process] handled exception (ignored):', err.message);
    return;
  }
  console.error('[process] uncaughtException:', err);
  // Non-Mongo fatal errors still exit so nodemon can restart cleanly
  process.exit(1);
});

import { requireAuth } from './middleware/auth.js';
import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import activityLogRoutes from './routes/activityLogRoutes.js';
import accessControlRoutes from './routes/accessControlRoutes.js';
import oversightRoutes from './routes/oversightRoutes.js';
import deviceRoutes from './routes/deviceRoutes.js';
import userRoutes from './routes/userRoutes.js';
import alertRoutes from './routes/alertRoutes.js';
import automationRoutes from './routes/automationRoutes.js';
import boardCatalogRoutes from './routes/boardCatalogRoutes.js';
import billingRoutes from './routes/billingRoutes.js';
import exportRoutes from './routes/exportRoutes.js';
import iotRoutes from './routes/iotRoutes.js';

const app = express();

// The bundled status page (public/index.html) has an inline <script> and
// pulls Google Fonts — scope the CSP to allow just those, everything else
// stays locked down. API responses are untouched by this.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'script-src': ["'self'", "'unsafe-inline'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'connect-src': ["'self'"],
    },
  },
}));
app.use(cors({ origin: (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean) }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Tighter limit on auth to blunt credential-stuffing / brute force attempts.
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false }));
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false }));
app.use('/api/demo', demoRoutes);
app.get('/health', (req, res) =>
  res.json({
    ok: true,
    db: DB_STATES[mongoose.connection.readyState] || 'unknown',
  })
);

// Detailed runtime diagnostics (uptime, env, Node/DB info) — behind auth so
// this isn't handed to anyone who can reach the port. The public status
// page only ever sees the plain {ok:true} above.
app.get('/api/system/status', requireAuth, (req, res) => res.json({
  ok: true,
  uptime: process.uptime(),
  env: process.env.NODE_ENV || 'development',
  node: process.version,
  port: PORT,
  db: { state: DB_STATES[mongoose.connection.readyState] || 'unknown' },
  timestamp: new Date().toISOString(),
}));

// Soft-fail API routes when Mongo is briefly offline (e.g. Wi‑Fi blip)
app.use('/api', (req, res, next) => {
  // Always allow auth health-style paths that do not need DB? Login needs DB.
  if (!isDbReady() && req.path !== '/system/status') {
    // /api prefix is already stripped by this mount? Actually app.use('/api', ...)
    // sees path relative to mount: e.g. /auth/login
    // Allow nothing that needs DB — return 503 so the UI can show a clear message.
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        error:
          'Database temporarily unavailable. Check your network and MongoDB Atlas status, then try again.',
        db: DB_STATES[mongoose.connection.readyState] || 'unknown',
      });
    }
  }
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/admins', adminRoutes);
app.use('/api/activity-logs', activityLogRoutes);
app.use('/api/access-control', accessControlRoutes);
app.use('/api/oversight', oversightRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/users', userRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/automations', automationRoutes);
app.use('/api/board-catalog', boardCatalogRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/iot',    iotRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`[server] listening on :${PORT}`);
    startDemoSensorSimulator();
  });
});