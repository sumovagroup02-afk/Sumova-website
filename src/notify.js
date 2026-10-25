import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { getSettings, audit } from './db.js';

// Fire-and-forget: a failing webhook or mail server must never break a customer's request.
export function notify(event, data, { subject, text } = {}) {
  const S = getSettings(), n = S.notifications || {};
  const body = JSON.stringify({ event, at: new Date().toISOString(), data });

  if (/^https?:\/\//.test(n.webhook_url || '')) {
    const headers = { 'content-type': 'application/json', 'user-agent': 'sumova-site/1' };
    if (n.webhook_secret) headers['x-sumova-signature'] = crypto.createHmac('sha256', n.webhook_secret).update(body).digest('hex');
    fetch(n.webhook_url, { method: 'POST', headers, body, signal: AbortSignal.timeout(6000) })
      .then((r) => { if (!r.ok) audit(null, 'webhook_failed', event, null, `HTTP ${r.status}`); })
      .catch((e) => audit(null, 'webhook_failed', event, null, e.message));
  }

  const to = String(n.emails || '').split(/[,\s]+/).filter((e) => /@/.test(e));
  const smtp = S.smtp || {};
  // a user without a saved password means SMTP is not set up yet: skip rather than log a failure per request
  if (to.length && smtp.host && subject && (!smtp.user || smtp.pass)) {
    const tx = nodemailer.createTransport({ host: smtp.host, port: Number(smtp.port) || 587, secure: !!smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined, connectionTimeout: 8000, socketTimeout: 10000 });
    tx.sendMail({ from: smtp.from || smtp.user, to, subject, text: text || subject })
      .catch((e) => audit(null, 'email_failed', event, null, e.message));
  }
}
