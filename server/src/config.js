const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const env = process.env;

function required(name, fallbackForDev) {
  const v = env[name];
  if (v) return v;
  if (env.NODE_ENV !== 'production' && fallbackForDev !== undefined) return fallbackForDev;
  throw new Error(`Missing required environment variable ${name}`);
}

const config = {
  env: env.NODE_ENV || 'development',
  isTest: env.NODE_ENV === 'test',
  port: Number(env.PORT || 4000),
  publicUrl: env.PUBLIC_URL || `http://localhost:${env.PORT || 4000}`,
  corsOrigins: (env.CORS_ORIGINS || 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
  db: {
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'smartoutpass',
    poolSize: Number(env.DB_POOL_SIZE || 10),
  },
  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET', 'dev-access-secret-change-me'),
    accessTtl: env.JWT_ACCESS_TTL || '15m',
    refreshTtlDays: Number(env.REFRESH_TOKEN_TTL_DAYS || 30),
  },
  qrSecret: required('QR_SIGNING_SECRET', 'dev-qr-secret-change-me'),
  bcryptRounds: Number(env.BCRYPT_ROUNDS || 10),
  enableJobs: (env.ENABLE_JOBS || 'true') === 'true',
  expoAccessToken: env.EXPO_ACCESS_TOKEN || '',
  sms: {
    provider: env.SMS_PROVIDER || 'console',
    twilioSid: env.TWILIO_ACCOUNT_SID || '',
    twilioToken: env.TWILIO_AUTH_TOKEN || '',
    twilioFrom: env.TWILIO_FROM || '',
  },
  ai: {
    provider: env.AI_PROVIDER || 'node',
    serviceUrl: env.AI_SERVICE_URL || 'http://localhost:8000',
    modelPath: path.resolve(__dirname, '..', env.AI_MODEL_PATH || './models/delay-model.json'),
  },
  uploadDir: path.join(__dirname, '..', 'uploads'),
};

module.exports = config;
