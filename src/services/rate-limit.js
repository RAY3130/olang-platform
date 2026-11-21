'use strict';

/*
 * Fixed-window rate limiting persisted in SQLite. Counts are stored against a
 * one-way key (never the raw IP/email) because keys are hashed by callers.
 */
function consume(db, key, limit, windowSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);
  db.prepare('DELETE FROM rate_limits WHERE window_start < ?').run(now - 86400);

  const transaction = db.prepare(`
    INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
    ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1
    RETURNING count
  `);
  const row = transaction.get(key, windowStart);
  const count = row ? row.count : 1;
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfter: Math.max(1, windowStart + windowSeconds - now),
  };
}

module.exports = { consume };
