'use strict';

class AppError extends Error {
  constructor(message, { status = 400, code = 'unknown', details = null } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

class ValidationError extends AppError {
  constructor(code, message = 'Validation failed.', details = null) {
    super(message, { status: 422, code, details });
    this.name = 'ValidationError';
  }
}

class RateLimitError extends AppError {
  constructor(message = 'Too many requests.', retryAfter = 60) {
    super(message, { status: 429, code: 'rate' });
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

module.exports = { AppError, ValidationError, RateLimitError };
