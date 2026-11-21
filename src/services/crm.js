'use strict';

const crypto = require('node:crypto');
const config = require('../config');
const { nowIso, truncate } = require('../lib/util');

/*
 * Generic CRM adapter. No provider-specific credentials are assumed. A real
 * CRM can receive a signed JSON payload at CRM_WEBHOOK_URL. Without a URL and
 * secret, this adapter is explicitly disabled and does not pretend to sync.
 */
async function pushInquiry(inquiry, items, fields) {
  if (!config.crm.configured) {
    return { configured: false, status: 'not_configured' };
  }
  const payload = JSON.stringify({
    event: 'inquiry.created',
    occurred_at: nowIso(),
    inquiry: {
      reference: inquiry.reference,
      type: inquiry.type,
      status: inquiry.status,
      name: inquiry.name,
      company: inquiry.company,
      email: inquiry.email,
      phone: inquiry.phone,
      country: inquiry.country,
      market: inquiry.market,
      locale: inquiry.locale,
      source_path: inquiry.source_path,
      message: inquiry.message,
      created_at: inquiry.created_at,
      items,
      fields,
    },
  });
  const signature = crypto.createHmac('sha256', config.crm.secret).update(payload).digest('hex');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const response = await fetch(config.crm.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OLANG-Signature': `sha256=${signature}`,
        'Idempotency-Key': inquiry.reference,
      },
      body: payload,
      signal: controller.signal,
    });
    clearTimeout(timer);
    return { configured: true, status: response.ok ? 'sent' : 'failed', httpStatus: response.status };
  } catch (error) {
    return { configured: true, status: 'failed', error: truncate(error.message, 300) };
  }
}

module.exports = { pushInquiry };
