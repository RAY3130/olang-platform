'use strict';

const { sha256, deviceFromUserAgent } = require('./util');

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded && req.app && req.app.get('trust proxy')) {
    return String(forwarded).split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function hashIp(req, salt) {
  return sha256(`${clientIp(req)}|${salt}`);
}

function countryFromRequest(req) {
  const value = req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || req.headers['x-country-code'];
  if (!value) return null;
  const code = String(value).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function requestMeta(req, salt) {
  const ua = String(req.headers['user-agent'] || '').slice(0, 400);
  return {
    ipHash: hashIp(req, salt),
    userAgent: ua,
    device: deviceFromUserAgent(ua),
    country: countryFromRequest(req),
  };
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients and same-origin form posts
  let expected;
  if (req.headers.host) {
    const proto = req.secure ? 'https' : (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    expected = `${proto}://${req.headers.host}`;
  }
  return origin === expected;
}

module.exports = { clientIp, hashIp, countryFromRequest, requestMeta, isSameOrigin };
