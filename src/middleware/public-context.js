'use strict';

const crypto = require('node:crypto');
const config = require('../config');
const { parseCookies, serializeCookie, appendCookie } = require('../lib/cookies');
const { randomToken, hmac, safeEqual } = require('../lib/util');
const { getConsent } = require('../services/consent');
const { getSetting } = require('../services/settings');

const VISITOR_COOKIE = 'olang_vid';
const CSRF_COOKIE = 'olang_csrf';
const CONSENT_COOKIE = 'olang_consent';

function cookieOptions(extra = {}) {
  return {
    secure: config.sessionCookieSecure,
    sameSite: 'Lax',
    path: '/',
    ...extra,
  };
}

function makeFormStamp(visitorId, salt) {
  const ts = Date.now();
  const value = `${visitorId}.${ts}`;
  const mac = hmac(value, salt).slice(0, 24);
  return Buffer.from(`${ts}.${mac}`).toString('base64url');
}

function verifyFormStamp(stamp, visitorId, salt) {
  try {
    const decoded = Buffer.from(String(stamp || ''), 'base64url').toString('utf8');
    const [tsText, mac] = decoded.split('.');
    const ts = Number(tsText);
    if (!Number.isFinite(ts)) return { ok: false, reason: 'invalid' };
    const expected = hmac(`${visitorId}.${ts}`, salt).slice(0, 24);
    if (!safeEqual(expected, mac)) return { ok: false, reason: 'invalid' };
    const age = Date.now() - ts;
    if (age < 1200) return { ok: false, reason: 'too_fast' };
    if (age > 3 * 60 * 60 * 1000) return { ok: false, reason: 'expired' };
    return { ok: true };
  } catch (_) {
    return { ok: false, reason: 'invalid' };
  }
}

function publicContext(db) {
  const salt = getSetting(db, 'security.ip_hash_salt', 'olang-form-salt');
  return function context(req, res, next) {
    req.cookies = parseCookies(req.headers.cookie);
    let visitorId = req.cookies[VISITOR_COOKIE];
    if (!visitorId || !/^[A-Za-z0-9_-]{20,60}$/.test(visitorId)) {
      visitorId = randomToken(24);
      appendCookie(res, serializeCookie(VISITOR_COOKIE, visitorId, cookieOptions({
        httpOnly: true, sameSite: 'Lax', maxAge: 365 * 24 * 3600,
      })));
    }
    req.visitorId = visitorId;

    let csrf = req.cookies[CSRF_COOKIE];
    if (!csrf || !/^[A-Za-z0-9_-]{20,80}$/.test(csrf)) {
      csrf = randomToken(24);
      appendCookie(res, serializeCookie(CSRF_COOKIE, csrf, cookieOptions({
        httpOnly: false, sameSite: 'Strict', maxAge: 12 * 3600,
      })));
    }
    req.publicCsrf = csrf;

    const consent = getConsent(db, visitorId);
    req.analyticsConsent = consent === true;
    req.consentKnown = consent !== null;
    const consentCookie = consent === true ? '1' : (consent === false ? '0' : '');
    if (req.cookies[CONSENT_COOKIE] !== consentCookie) {
      appendCookie(res, serializeCookie(CONSENT_COOKIE, consentCookie, cookieOptions({
        httpOnly: false, sameSite: 'Lax', maxAge: 180 * 24 * 3600,
      })));
    }

    res.locals.visitorId = visitorId;
    res.locals.csrfToken = csrf;
    res.locals.analyticsConsent = consent === true;
    res.locals.consentKnown = consent !== null;
    res.locals.cookiePolicyVersion = config.privacy.cookiePolicyVersion;
    res.locals.cookieConsentValue = consentCookie;
    res.locals.formStamp = makeFormStamp(visitorId, salt);
    res.locals.demoMode = config.isDemo;
    res.locals.siteMode = config.siteMode;
    res.locals.currentYear = new Date().getFullYear();
    res.locals.config = config;
    next();
  };
}

function verifyPublicCsrf(req) {
  const cookie = req.cookies && req.cookies[CSRF_COOKIE];
  const bodyToken = (req.body && req.body._csrf) || req.headers['x-csrf-token'] || '';
  if (!cookie || !bodyToken || String(cookie).length !== String(bodyToken).length) return false;
  return safeEqual(cookie, bodyToken);
}

function verifyStamp(req) {
  const stamp = req.body && req.body.form_stamp;
  const salt = req.formSalt || req.app.locals.formSalt;
  if (!salt) return { ok: true };
  return verifyFormStamp(stamp, req.visitorId, salt);
}

module.exports = {
  VISITOR_COOKIE, CSRF_COOKIE, CONSENT_COOKIE,
  publicContext, verifyPublicCsrf, verifyFormStamp, makeFormStamp,
};
