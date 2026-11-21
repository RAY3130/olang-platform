'use strict';

const nodemailer = require('nodemailer');
const config = require('../config');
const { nowIso, truncate } = require('../lib/util');

let transporter = null;

function getTransporter() {
  if (!config.email.configured) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.secure,
      auth: config.email.user ? { user: config.email.user, pass: config.email.pass } : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  }
  return transporter;
}

const TYPE_LABELS = {
  wholesale: 'Wholesale inquiry',
  oem: 'OEM / ODM inquiry',
  project: 'Project inquiry',
  product_info: 'Product information request',
  document_request: 'Document request',
  general: 'General inquiry',
  privacy: 'Privacy request',
};

function ackText(inquiry) {
  const locale = inquiry.locale || 'en';
  const copy = {
    en: {
      subject: `We received your inquiry ${inquiry.reference}`,
      greeting: `Hello ${inquiry.name},`,
      body: 'Your inquiry has been recorded by the OLANG website demonstration. It is not yet a quotation, contract, stock reservation or certification.',
      next: 'Keep this reference. Specification, document scope, availability and commercial terms will be checked before a quotation.',
      demo: 'This environment may not have production email delivery connected. If the matter is urgent, use the public contact channel.',
    },
    de: {
      subject: `Ihre Anfrage ${inquiry.reference} ist eingegangen`,
      greeting: `Guten Tag ${inquiry.name},`,
      body: 'Ihre Anfrage wurde in der OLANG-Website-Demonstration gespeichert. Sie ist noch kein Angebot, Vertrag, keine Bestandsreservierung und keine Zertifizierung.',
      next: 'Bewahren Sie diese Referenz auf. Spezifikation, Dokumentenumfang, Verfügbarkeit und Handelsbedingungen werden vor einem Angebot geprüft.',
      demo: 'In dieser Umgebung ist der Produktions-E-Mail-Versand möglicherweise nicht verbunden. Bei dringenden Anliegen nutzen Sie bitte den öffentlichen Kontaktkanal.',
    },
    it: {
      subject: `La richiesta ${inquiry.reference} è stata ricevuta`,
      greeting: `Gentile ${inquiry.name},`,
      body: 'La richiesta è stata registrata nella dimostrazione del sito OLANG. Non costituisce ancora un preventivo, un contratto, una prenotazione di scorte o una certificazione.',
      next: 'Conserva questo riferimento. Specifica, ambito documentale, disponibilità e condizioni commerciali saranno verificati prima del preventivo.',
      demo: 'In questo ambiente l’invio email di produzione potrebbe non essere collegato. Per urgenze usa il canale pubblico.',
    },
  };
  const text = copy[locale] || copy.en;
  return {
    subject: text.subject,
    body: [
      text.greeting,
      '',
      text.body,
      '',
      `Reference: ${inquiry.reference}`,
      `Inquiry type: ${TYPE_LABELS[inquiry.type] || inquiry.type}`,
      '',
      text.next,
      '',
      text.demo,
      '',
      'Privacy: /privacy',
      '',
      'OLANG international website demonstration',
    ].join('\n'),
  };
}

function notificationText(inquiry, items, fields, files) {
  const itemLines = items.length
    ? items.map((item) => `- ${item.sku} | ${item.product_name} | qty: ${item.quantity || 'not supplied'} | ${item.notes || ''}`)
    : ['- No SKU list attached.'];
  const fieldLines = Object.entries(fields).map(([key, value]) => `- ${key}: ${value}`);
  return {
    subject: `[OLANG] ${TYPE_LABELS[inquiry.type] || inquiry.type} ${inquiry.reference}`,
    body: [
      `New inquiry: ${inquiry.reference}`,
      `Type: ${inquiry.type}`,
      `Status: ${inquiry.status}`,
      `Received: ${inquiry.created_at}`,
      '',
      `Name: ${inquiry.name}`,
      `Company: ${inquiry.company || '—'}`,
      `Email: ${inquiry.email}`,
      `Phone: ${inquiry.phone || '—'}`,
      `Country: ${inquiry.country}`,
      `Market edition: ${inquiry.market}`,
      `Source: ${inquiry.source_page || inquiry.source_path || '—'}`,
      '',
      'Products:',
      ...itemLines,
      '',
      'Request fields:',
      ...(fieldLines.length ? fieldLines : ['- None']),
      '',
      'Requirements:',
      inquiry.message,
      '',
      `Attachments: ${files.length ? files.map((f) => f.original_name).join(', ') : 'none'}`,
      '',
      'Open the staff portal to view the inquiry, assign it and change status.',
    ].join('\n'),
  };
}

function insertOutbox(db, inquiry, kind, toEmail, subject, body, status, extra = {}) {
  const now = nowIso();
  const info = db.prepare(`
    INSERT INTO email_outbox (inquiry_id, to_email, kind, subject, body_text, status, provider, provider_id, error, attempts, created_at, sent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    inquiry.id, toEmail || 'not-configured@invalid', kind, truncate(subject, 300), body,
    status, extra.provider || null, extra.providerId || null, extra.error || null,
    extra.attempts || 0, now, status === 'sent' ? now : null,
  );
  return Number(info.lastInsertRowid);
}

async function deliver(db, inquiry, items, fields, files) {
  const notification = notificationText(inquiry, items, fields, files);
  const ack = ackText(inquiry);
  const results = { notification: null, acknowledgement: null, configured: config.email.configured };
  const transport = getTransporter();

  if (!transport) {
    insertOutbox(db, inquiry, 'notification', config.email.notificationTo, notification.subject, notification.body, 'not_configured', {
      provider: 'outbox', error: 'SMTP transport or INQUIRY_NOTIFICATION_EMAIL is not configured.',
    });
    insertOutbox(db, inquiry, 'acknowledgement', inquiry.email, ack.subject, ack.body, 'not_configured', {
      provider: 'outbox', error: 'SMTP transport is not configured.',
    });
    results.notification = 'not_configured';
    results.acknowledgement = 'not_configured';
    return results;
  }

  const internalOutboxId = insertOutbox(
    db, inquiry, 'notification', config.email.notificationTo,
    notification.subject, notification.body, 'pending', { provider: 'smtp' },
  );
  try {
    const info = await transport.sendMail({
      from: config.email.from,
      to: config.email.notificationTo,
      replyTo: inquiry.email,
      subject: notification.subject,
      text: notification.body,
    });
    db.prepare('UPDATE email_outbox SET status = ?, provider_id = ?, attempts = 1, sent_at = ? WHERE id = ?')
      .run('sent', info.messageId || null, nowIso(), internalOutboxId);
    results.notification = 'sent';
  } catch (error) {
    db.prepare('UPDATE email_outbox SET status = ?, error = ?, attempts = 1 WHERE id = ?')
      .run('failed', truncate(error.message, 500), internalOutboxId);
    results.notification = 'failed';
  }

  const ackOutboxId = insertOutbox(
    db, inquiry, 'acknowledgement', inquiry.email,
    ack.subject, ack.body, 'pending', { provider: 'smtp' },
  );
  try {
    const info = await transport.sendMail({
      from: config.email.from,
      to: inquiry.email,
      replyTo: config.email.replyTo || config.email.notificationTo,
      subject: ack.subject,
      text: ack.body,
    });
    db.prepare('UPDATE email_outbox SET status = ?, provider_id = ?, attempts = 1, sent_at = ? WHERE id = ?')
      .run('sent', info.messageId || null, nowIso(), ackOutboxId);
    results.acknowledgement = 'sent';
  } catch (error) {
    db.prepare('UPDATE email_outbox SET status = ?, error = ?, attempts = 1 WHERE id = ?')
      .run('failed', truncate(error.message, 500), ackOutboxId);
    results.acknowledgement = 'failed';
  }
  return results;
}

function deliveryLabel(status) {
  if (status === 'sent') return 'sent';
  if (status === 'failed') return 'failed';
  if (status === 'not_configured') return 'not_configured';
  return 'queued';
}

module.exports = { deliver, deliveryLabel, ackText, notificationText };
