'use strict';

function parseCookies(header) {
  const result = {};
  if (!header) return result;
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try { result[key] = decodeURIComponent(value); } catch (_) { result[key] = value; }
  }
  return result;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);
  if (options.maxAge != null) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  return parts.join('; ');
}

function appendCookie(res, cookie) {
  const current = res.getHeader('Set-Cookie');
  if (!current) {
    res.setHeader('Set-Cookie', [cookie]);
  } else if (Array.isArray(current)) {
    res.setHeader('Set-Cookie', current.concat(cookie));
  } else {
    res.setHeader('Set-Cookie', [current, cookie]);
  }
}

module.exports = { parseCookies, serializeCookie, appendCookie };
