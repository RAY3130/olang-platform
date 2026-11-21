'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.resolve(__dirname, '..');

function bool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function int(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const nodeEnv = process.env.NODE_ENV || 'development';
const siteMode = process.env.SITE_MODE === 'production' ? 'production' : 'demo';
const siteUrl = (process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || 'http://127.0.0.1:4174').replace(/\/+$/, '');
const emailTransport = process.env.EMAIL_TRANSPORT === 'smtp' ? 'smtp' : 'outbox';
const smtpConfigured = emailTransport === 'smtp' && Boolean(process.env.SMTP_HOST && process.env.INQUIRY_NOTIFICATION_EMAIL);

const secureSetting = process.env.SESSION_COOKIE_SECURE || 'auto';
const secureCookies = secureSetting === 'auto'
  ? siteUrl.startsWith('https://') || nodeEnv === 'production'
  : bool(secureSetting);

const config = {
  root: ROOT,
  nodeEnv,
  siteMode,
  isProduction: nodeEnv === 'production',
  isDemo: siteMode !== 'production',
  host: process.env.HOST || '127.0.0.1',
  port: int(process.env.PORT, 4174),
  siteUrl,
  siteName: process.env.SITE_NAME || 'OLANG',
  dbPath: path.resolve(ROOT, process.env.DB_PATH || './storage/olang.sqlite'),
  uploadDir: path.resolve(ROOT, process.env.UPLOAD_DIR || './storage/uploads'),
  sessionCookieSecure: secureCookies,
  trustProxy: bool(process.env.TRUST_PROXY, false),
  proxyHops: int(process.env.PROXY_HOPS, 0),
  admin: {
    username: process.env.ADMIN_INITIAL_USERNAME || 'admin',
    email: process.env.ADMIN_INITIAL_EMAIL || '',
    password: process.env.ADMIN_INITIAL_PASSWORD || '',
  },
  email: {
    transport: emailTransport,
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'OLANG Website <no-reply@example.invalid>',
    notificationTo: process.env.INQUIRY_NOTIFICATION_EMAIL || '',
    replyTo: process.env.INQUIRY_REPLY_TO || '',
    configured: smtpConfigured,
  },
  crm: {
    url: process.env.CRM_WEBHOOK_URL || '',
    secret: process.env.CRM_WEBHOOK_SECRET || '',
    configured: Boolean(process.env.CRM_WEBHOOK_URL && process.env.CRM_WEBHOOK_SECRET),
  },
  assistant: {
    enabled: bool(process.env.ASSISTANT_LLM_ENABLED, false) && Boolean(process.env.ASSISTANT_API_KEY && process.env.ASSISTANT_BASE_URL && process.env.ASSISTANT_MODEL),
    apiKey: process.env.ASSISTANT_API_KEY || '',
    baseUrl: (process.env.ASSISTANT_BASE_URL || '').replace(/\/+$/, ''),
    model: process.env.ASSISTANT_MODEL || '',
    timeoutMs: int(process.env.ASSISTANT_TIMEOUT_MS, 12000),
    maxTokens: int(process.env.ASSISTANT_MAX_TOKENS, 500),
  },
  privacy: {
    cookiePolicyVersion: process.env.COOKIE_POLICY_VERSION || '2026-11-07',
    analyticsRetentionDays: int(process.env.ANALYTICS_RETENTION_DAYS, 400),
    inquiryRetentionMonths: int(process.env.INQUIRY_RETENTION_MONTHS, 24),
    uploadRetentionMonths: int(process.env.UPLOAD_RETENTION_MONTHS, 12),
  },
  uploads: {
    maxBytes: int(process.env.MAX_UPLOAD_BYTES, 10 * 1024 * 1024),
    maxFiles: int(process.env.MAX_UPLOAD_FILES, 5),
  },
  publicContact: {
    // Reproduced from OLANG's public Contact page, accessed 2026-11-07.
    email: 'master@olang.cn',
    phone: '+86 757 8539 4277',
    phoneHref: '+8675785394277',
    company: 'Foshan Langhao Hardware',
    companyCn: '佛山市禅城区朗豪五金制品厂',
    address: {
      street: 'Chancheng District',
      city: 'Foshan',
      region: 'Guangdong',
      country: 'CN',
      postalCode: '528000',
      display: 'Chancheng District, Foshan, Guangdong, China',
    },
  },
};

// WhatsApp deep link built from the published switchboard number. The number is the one OLANG
// prints on its public contact page; the company still has to confirm that it receives
// WhatsApp messages before launch, and the report records that dependency.
config.whatsappUrl = `https://wa.me/${config.publicContact.phoneHref.replace(/\D/g, '')}`;
config.catalogue = {
  path: '/downloads/olang-catalogue-2026.pdf',
  filename: 'olang-catalogue-2026.pdf',
  eventName: 'catalogue_download',
};

const localHttp = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(siteUrl);
config.indexingAllowed = siteMode === 'production'
  && bool(process.env.ALLOW_SEARCH_INDEXING, true)
  && (siteUrl.startsWith('https://') || localHttp);

if (siteMode === 'production') {
  const missing = [];
  if (!config.email.configured) missing.push('SMTP transport + INQUIRY_NOTIFICATION_EMAIL');
  if (!siteUrl.startsWith('https://')) missing.push('HTTPS SITE_URL');
  if (missing.length) {
    console.warn(`[startup] production mode is missing: ${missing.join('; ')}. Inquiries will still be stored; email delivery is reported as not configured.`);
  }
}

module.exports = config;
