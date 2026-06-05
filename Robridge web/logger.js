/**
 * Centralized Structured Logger using Winston
 * 
 * Usage:
 *   const logger = require('./logger');
 *   logger.info('Server started', { port: 3001 });
 *   logger.warn('Low stock', { barcode: 'ABC', stock: 2 });
 *   logger.error('DB error', { error: err.message });
 */

const { createLogger, format, transports } = require('winston');

const { combine, timestamp, printf, colorize, errors, json } = format;

const isDev = process.env.NODE_ENV !== 'production';

// Human-readable format for development
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `[${ts}] ${level}: ${message}${metaStr}`;
  })
);

// Structured JSON format for production (log aggregators, Datadog, etc.)
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

const logger = createLogger({
  level: isDev ? 'debug' : 'info',
  format: isDev ? devFormat : prodFormat,
  transports: [
    new transports.Console(),
  ],
  // Don't exit on uncaught exceptions (we handle that in server.js)
  exitOnError: false,
});

// Express request logger middleware
logger.requestMiddleware = (req, res, next) => {
  const start = Date.now();
  // Skip health checks from logs
  if (req.path === '/api/health') return next();

  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug';
    logger[level](`${req.method} ${req.path} ${res.statusCode} ${ms}ms`, {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms,
      ip: req.ip,
    });
  });
  next();
};

module.exports = logger;
