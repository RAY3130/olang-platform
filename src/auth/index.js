'use strict';

const crypto = require('node:crypto');
const { sha256, randomToken, nowIso } = require('../lib/util');
const { appendCookie, serializeCookie } = require('../lib/cookies');
const config = require('../config');

const ADMIN_COOKIE = 'olang_admin';
const LOGIN_CSRF_COOKIE = 'olang_login_csrf';
const SESSION_HOURS = 8;

const ROLE_LABELS = {
  super_admin: 'Super Admin',
  content_manager: 'Content Manager',
  sales_manager: 'Sales Manager',
  sales_staff: 'Sales Staff',
};

const PERMISSIONS = {
  super_admin: new Set(['*']),
  content_manager: new Set(['dashboard', 'content', 'products', 'documents', 'faqs', 'cases']),
  sales_manager: new Set(['dashboard', 'analytics', 'inquiries', 'export', 'products_read']),
  sales_staff: new Set(['dashboard', 'inquiries_assigned']),
};

function can(user, permission) {
  if (!user) return false;
  const set = PERMISSIONS[user.role];
  if (!set) return false;
  return set.has('*') || set.has(permission);
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    email: user.email,
    role: user.role,
    roleLabel: ROLE_LABELS[user.role] || user.role,
    mustChangePassword: Boolean(user.must_change_password),
  };
}

function createAdminSession(db, userId, meta = {}) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const createdAt = nowIso();
  const expires = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
  db.prepare(`
    INSERT INTO sessions (user_id, token_hash, csrf_token, ip_hash, user_agent, created_at, last_seen_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, sha256(token), csrf, meta.ipHash || null, meta.userAgent || null, createdAt, createdAt, expires);
  return { token, csrf, expires };
}

function sessionCookie(token, expires) {
  return serializeCookie(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: config.sessionCookieSecure,
    sameSite: 'Lax',
    maxAge: Math.max(1, Math.floor((new Date(expires).getTime() - Date.now()) / 1000)),
    path: '/',
  });
}

function clearSessionCookie() {
  return serializeCookie(ADMIN_COOKIE, '', {
    httpOnly: true,
    secure: config.sessionCookieSecure,
    sameSite: 'Lax',
    maxAge: 0,
    path: '/',
  });
}

function findSession(db, token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT s.id AS session_id, s.csrf_token, s.expires_at, s.last_seen_at,
           u.*
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND u.active = 1 AND s.expires_at > ?
  `).get(sha256(token), nowIso());
  if (!row) return null;
  if (new Date(row.last_seen_at).getTime() < Date.now() - 5 * 60 * 1000) {
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(nowIso(), row.session_id);
  }
  return { sessionId: row.session_id, csrfToken: row.csrf_token, user: row };
}

function deleteSession(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

function deleteUserSessions(db, userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

function purgeExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso());
}

function loginCsrf(req, res) {
  let token = req.cookies[LOGIN_CSRF_COOKIE];
  if (!token || token.length < 20) {
    token = crypto.randomBytes(24).toString('base64url');
    appendCookie(res, serializeCookie(LOGIN_CSRF_COOKIE, token, {
      httpOnly: false,
      secure: config.sessionCookieSecure,
      sameSite: 'Strict',
      maxAge: 1800,
      path: '/admin',
    }));
  }
  return token;
}

function verifyLoginCsrf(req) {
  const cookie = req.cookies[LOGIN_CSRF_COOKIE] || '';
  const body = (req.body && (req.body._csrf || req.headers['x-csrf-token'])) || '';
  if (!cookie || !body || cookie.length !== String(body).length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(String(body)));
  } catch (_) {
    return false;
  }
}

function attachAdmin(db) {
  return function adminSession(req, res, next) {
    req.admin = null;
    res.locals.adminUser = null;
    const token = req.cookies[ADMIN_COOKIE];
    if (token) {
      const session = findSession(db, token);
      if (session) {
        req.admin = { ...session, user: publicUser(session.user) };
        res.locals.adminUser = req.admin.user;
        res.locals.adminCsrf = session.csrfToken;
        res.locals.can = (permission) => can(session.user, permission);
      }
    }
    next();
  };
}

function requireAdmin(req, res, next) {
  if (!req.admin) {
    if (req.method === 'GET') {
      const nextPath = req.originalUrl.startsWith('/admin') ? req.originalUrl : '/admin';
      return res.redirect(`/admin/login?next=${encodeURIComponent(nextPath)}`);
    }
    return res.status(401).json({ ok: false, error: 'Authentication required.' });
  }
  next();
}

function requirePermission(permission) {
  return function permissionGate(req, res, next) {
    if (!req.admin) {
      if (req.method === 'GET') {
        return res.redirect(`/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
      }
      return res.status(401).json({ ok: false, error: 'Authentication required.' });
    }
    if (!can(req.admin.user, permission)) {
      if (req.method === 'GET') {
        return res.status(403).render('admin/forbidden', {
          title: 'Access denied', active: '', adminUser: req.admin.user, csrf: req.admin.csrfToken,
        });
      }
      return res.status(403).json({ ok: false, error: 'You do not have permission for this action.' });
    }
    next();
  };
}

function requireCsrf(req, res, next) {
  if (!req.admin) return res.status(401).json({ ok: false, error: 'Authentication required.' });
  const supplied = (req.body && req.body._csrf) || req.headers['x-csrf-token'] || '';
  const expected = req.admin.csrfToken || '';
  if (!supplied || supplied.length !== expected.length) {
    return res.status(403).json({ ok: false, error: 'Security token expired. Refresh the page and try again.' });
  }
  try {
    if (!crypto.timingSafeEqual(Buffer.from(String(supplied)), Buffer.from(String(expected)))) {
      return res.status(403).json({ ok: false, error: 'Security token expired. Refresh the page and try again.' });
    }
  } catch (_) {
    return res.status(403).json({ ok: false, error: 'Security token expired. Refresh the page and try again.' });
  }
  next();
}

function safeNextPath(value) {
  const next = String(value || '');
  return next.startsWith('/admin') && !next.startsWith('//') ? next : '/admin';
}

module.exports = {
  ADMIN_COOKIE,
  ROLE_LABELS,
  can,
  publicUser,
  createAdminSession,
  sessionCookie,
  clearSessionCookie,
  findSession,
  deleteSession,
  deleteUserSessions,
  purgeExpiredSessions,
  loginCsrf,
  verifyLoginCsrf,
  attachAdmin,
  requireAdmin,
  requirePermission,
  requireCsrf,
  safeNextPath,
};
