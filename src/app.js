'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const config = require('./config');
const { parseCookies } = require('./lib/cookies');
const { getSetting } = require('./services/settings');
const { AppError } = require('./lib/app-error');

function securityHeaders(req, res, next) {
  const nonce = crypto.randomBytes(18).toString('base64');
  res.locals.cspNonce = nonce;
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' blob:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "manifest-src 'self'",
  ];
  if (config.siteUrl.startsWith('https://')) directives.push('upgrade-insecure-requests');
  res.setHeader('Content-Security-Policy', directives.join('; '));
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  next();
}

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.proxyHops > 0 ? config.proxyHops : 1);

  app.locals.db = db;
  app.locals.formSalt = getSetting(db, 'security.ip_hash_salt', 'olang-form-salt');
  app.locals.site = config;
  const assetFiles = ['main.css', 'site.js', 'admin.css', 'admin.js']
    .map((name) => {
      try { return fs.statSync(path.join(config.root, 'public', 'assets', name)).mtimeMs; } catch (_) { return 0; }
    });
  const assetVersion = crypto.createHash('sha1').update(assetFiles.join('|')).digest('hex').slice(0, 10);
  app.locals.assetVersion = assetVersion;

  app.use((req, res, next) => {
    req.cookies = parseCookies(req.headers.cookie);
    res.locals.cspNonce = '';
    next();
  });
  app.use(securityHeaders);
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    hsts: config.siteUrl.startsWith('https://') ? { maxAge: 31536000, includeSubDomains: true, preload: false } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));
  app.use(compression());
  app.use(express.urlencoded({ extended: false, limit: '250kb', parameterLimit: 200 }));
  app.use(express.json({ limit: '200kb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.use('/assets', express.static(path.join(config.root, 'public', 'assets'), {
    maxAge: config.isProduction ? '7d' : 0,
    etag: true,
    fallthrough: true,
  }));
  app.use('/images', express.static(path.join(config.root, 'public', 'images'), {
    maxAge: config.isProduction ? '30d' : 0,
    etag: true,
    fallthrough: true,
    dotfiles: 'deny',
  }));
  app.use('/uploads', express.static(path.join(config.root, 'public', 'uploads'), {
    maxAge: config.isProduction ? '30d' : 0,
    etag: true,
    fallthrough: true,
    dotfiles: 'deny',
  }));
  app.use('/vendor', express.static(path.join(config.root, 'public', 'vendor'), {
    maxAge: config.isProduction ? '30d' : 0,
    etag: true,
    fallthrough: true,
    dotfiles: 'deny',
  }));
  app.use('/downloads', express.static(path.join(config.root, 'public', 'downloads'), {
    maxAge: config.isProduction ? '7d' : 0,
    etag: true,
    fallthrough: true,
    dotfiles: 'deny',
  }));

  // The product-model route is retired. Requests for archived model paths answer 404
  // instead of falling through to the static handler or the 500 path.
  app.use('/models', (req, res) => res.status(404).type('text/plain').send('Not found'));

  app.get('/healthz', (req, res) => {
    res.json({
      ok: true,
      mode: config.siteMode,
      email: config.email.configured ? 'configured' : 'not_configured',
      time: new Date().toISOString(),
    });
  });

  app.use('/api', require('./routes/api'));
  app.use('/admin', require('./routes/admin')(db));
  app.use('/', require('./routes/public'));

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: 'not_found' });
    res.status(404).type('text/plain').send('Not found');
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || (error.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error('[error]', error);
    if (req.path.startsWith('/api/')) {
      if (error instanceof AppError) {
        return res.status(status).json({ ok: false, error: error.code, message: error.message });
      }
      return res.status(status).json({ ok: false, error: status >= 500 ? 'unknown' : 'bad_request' });
    }
    if (status >= 500) {
      return res.status(500).type('text/plain').send('Something went wrong. Please try again or contact us by email.');
    }
    return res.status(status).type('text/plain').send('Bad request.');
  });

  return app;
}

module.exports = { createApp };
