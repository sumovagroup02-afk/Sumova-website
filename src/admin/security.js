// Two-step verification (login step, enrolment, recovery codes) and «جلساتي» (own sessions)
import express from 'express';
import { html, raw } from '../html.js';
import { one, all, run, audit } from '../db.js';
import { verifyPassword, upgradeSession, destroySession } from '../auth.js';
import { MFA_ROLES, newSecret, verifyTotp, otpauthUri, qrSvg, newRecoveryCodes, recoveryLeft, checkSecondFactor, disableTotp } from '../totp.js';
import { shell, flash, csrf, fld, fmtDate, pageHead } from './ui.js';

export const securityRouter = express.Router();
const MAX_TRIES = 5;

// Partial sessions (password accepted, 2FA pending or not yet set up) reach only these pages.
export function stageGate(req, res, next) {
  // also catches sessions opened before 2FA became mandatory, or after a role change
  if (req.stage === 'ok' && MFA_ROLES.includes(req.user.role) && !req.user.totp_on) req.stage = 'setup';
  if (req.stage === 'mfa') return /^\/(login\/2fa|logout)$/.test(req.path) ? next() : res.redirect('/admin/login/2fa');
  if (req.stage === 'setup') return /^\/(account\/2fa(\/enable)?|logout)$/.test(req.path) ? next() : res.redirect('/admin/account/2fa');
  if (/^\/login\/2fa$/.test(req.path)) return res.redirect('/admin');
  next();
}

// minimal page (no dashboard menu) for the steps before a full sign-in
const bare = (res, title, body, status = 200) => res.status(status).type('html').send(html`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${title} – سوموفا</title><link rel="icon" href="/brand/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/css/site.css"><link rel="stylesheet" href="/css/admin.css?v=1"></head>
<body class="adm login"><main class="login__box"><img src="/brand/logo-ar-onlight.svg" alt="سوموفا" width="170" height="48">${body}</main></body></html>`.toString());

const codeField = (label = 'رمز التحقق') => html`<div class="fld"><label for="code">${label}</label><input id="code" name="code" required autocomplete="one-time-code" inputmode="numeric" dir="ltr" maxlength="11" autofocus></div>`;
const logoutForm = (req) => html`<form method="post" action="/admin/logout" class="inline">${csrf(req)}<button class="linkbtn plain">إلغاء وتسجيل الخروج</button></form>`;

// ───────── login step 2
const mfaPage = (req, res, error = '', status = 200) => bare(res, 'التحقق بخطوتين', html`<h1>التحقق بخطوتين</h1>
  <form method="post" action="/admin/login/2fa" class="form" autocomplete="off">${csrf(req)}
    ${error ? html`<div class="notice bad" role="alert">${error}</div>` : ''}
    <p class="hint">افتح تطبيق المصادقة على جوالك واكتب الرمز المكوّن من 6 أرقام. إن فقدت جوالك اكتب أحد رموز الاسترداد.</p>
    ${codeField('الرمز')}
    <button class="btn btn--ink" type="submit">تحقّق</button>
  </form>${logoutForm(req)}`, status);

securityRouter.get('/login/2fa', (req, res) => mfaPage(req, res));
securityRouter.post('/login/2fa', (req, res) => {
  const u = one('SELECT * FROM users WHERE id=?', req.user.id);
  const how = u.totp_on ? checkSecondFactor(u, req.body.code) : null;
  if (!how) {
    run('UPDATE sessions SET tries=tries+1 WHERE rowid=?', req.sid);
    const n = one('SELECT tries FROM sessions WHERE rowid=?', req.sid)?.tries ?? MAX_TRIES;
    audit(u, 'login_2fa_failed', 'user', u.id);
    if (n >= MAX_TRIES) { destroySession(req, res); return res.redirect('/admin/login?e=2fa'); }
    return mfaPage(req, res, `الرمز غير صحيح. بقيت ${MAX_TRIES - n} محاولات.`, 401);
  }
  upgradeSession(req, res, u, 'ok');
  audit(u, 'login', 'user', u.id, how === 'recovery' ? `برمز استرداد (بقي ${recoveryLeft(u.id)})` : '');
  if (how === 'recovery') flash(res, 'ok', `دخلت برمز استرداد. بقي لديك ${recoveryLeft(u.id)} رموز؛ أنشئ رموزًا جديدة من «حسابي» عند الحاجة.`);
  res.redirect('/admin');
});

// ───────── enrolment & management
const codesList = (codes) => html`<ol class="rcodes" dir="ltr">${codes.map((c) => html`<li><code>${c}</code></li>`)}</ol>`;
const showCodes = (req, res, codes, intro) => {
  const body = html`<div class="notice"><b>${intro}</b><br>احفظ هذه الرموز في مكان آمن (خارج الجوال). كل رمز يُستخدم مرة واحدة للدخول إذا فقدت جوالك. لن تظهر مرة أخرى.</div>
    ${codesList(codes)}<p><a class="btn btn--ink" href="/admin/account/2fa" data-codes-done>حفظتها، متابعة</a></p>`;
  return shell(req, res, { title: 'رموز الاسترداد', active: '/admin/account', body: html`${pageHead('رموز الاسترداد')}<section class="card narrow">${body}</section>` });
};

securityRouter.get('/account/2fa', (req, res) => {
  const me = one('SELECT * FROM users WHERE id=?', req.user.id);
  const required = MFA_ROLES.includes(me.role);
  if (!me.totp_on) {
    let secret = me.totp_secret;
    if (!secret) { secret = newSecret(); run('UPDATE users SET totp_secret=?, totp_step=0 WHERE id=?', secret, me.id); }
    const steps = html`<ol class="steps2fa">
      <li>ثبّت تطبيق مصادقة على جوالك، مثل Google Authenticator أو Microsoft Authenticator.</li>
      <li>امسح رمز QR بالتطبيق، أو أدخل المفتاح يدويًا.</li>
      <li>اكتب الرمز المكوّن من 6 أرقام الذي يظهر في التطبيق.</li></ol>
      <div class="qr">${raw(qrSvg(otpauthUri(secret, me.email)))}</div>
      <p class="hint">المفتاح اليدوي: <code dir="ltr" data-secret>${secret.replace(/(.{4})/g, '$1 ').trim()}</code></p>
      <form method="post" action="/admin/account/2fa/enable" class="form">${csrf(req)}${codeField()}<button class="btn btn--ink" type="submit">تفعيل</button></form>`;
    if (req.stage === 'setup') return bare(res, 'تفعيل التحقق بخطوتين', html`<h1>تفعيل التحقق بخطوتين</h1>
      <p class="notice">التحقق بخطوتين إلزامي لصلاحية «${me.role === 'owner' ? 'مالك' : 'مدير'}». فعّله الآن للمتابعة إلى لوحة التحكم.</p>
      ${req.query.e ? html`<div class="notice bad" role="alert">الرمز غير صحيح. تأكد من وقت الجوال وحاول مرة أخرى.</div>` : ''}${steps}${logoutForm(req)}`);
    return shell(req, res, { title: 'التحقق بخطوتين', active: '/admin/account', body: html`${pageHead('التحقق بخطوتين')}
      <section class="card narrow stack">${required ? html`<p class="notice">إلزامي لصلاحيتك.</p>` : html`<p class="hint">اختياري لصلاحيتك، ويحمي حسابك إن تسرّبت كلمة المرور.</p>`}${steps}</section>` });
  }
  const left = recoveryLeft(me.id);
  shell(req, res, { title: 'التحقق بخطوتين', active: '/admin/account', body: html`${pageHead('التحقق بخطوتين')}
    <section class="card narrow stack"><p class="ok" data-2fa-on>التحقق بخطوتين مفعّل على حسابك.</p>
      <p>رموز الاسترداد المتبقية: <b data-rc-left>${left}</b> من 10${left <= 3 ? html` <span class="pill s-rejected">أنشئ رموزًا جديدة</span>` : ''}</p>
      <form method="post" action="/admin/account/2fa/codes" class="form"><h2>إنشاء رموز استرداد جديدة</h2><p class="hint">تُلغى الرموز القديمة كلها.</p>${csrf(req)}${codeField('رمز التطبيق الحالي')}<button class="btn-s" type="submit">إنشاء رموز جديدة</button></form>
      ${required ? html`<p class="hint">لا يمكن إيقاف التحقق بخطوتين لصلاحية المالك أو المدير. إن فقدت جوالك ورموز الاسترداد، اطلب من مالك آخر إعادة ضبطه من «المستخدمون».</p>`
        : html`<form method="post" action="/admin/account/2fa/disable" class="form"><h2>إيقاف التحقق بخطوتين</h2>${csrf(req)}${fld('password', 'كلمة المرور', '', { type: 'password', dir: 'ltr', attrs: 'required autocomplete="current-password"' })}${codeField('رمز التطبيق الحالي')}<button class="linkbtn bad" type="submit" data-confirm="إيقاف التحقق بخطوتين؟">إيقاف</button></form>`}
    </section>` });
});

securityRouter.post('/account/2fa/enable', (req, res) => {
  const me = one('SELECT * FROM users WHERE id=?', req.user.id);
  if (me.totp_on) return res.redirect('/admin/account/2fa');
  const s = verifyTotp(me.totp_secret, req.body.code, 0);
  if (!s) { if (req.stage !== 'setup') flash(res, 'bad', 'الرمز غير صحيح. تأكد من وقت الجوال وحاول مرة أخرى.'); return res.redirect('/admin/account/2fa?e=1'); }
  run('UPDATE users SET totp_on=1, totp_step=? WHERE id=?', s, me.id);
  const codes = newRecoveryCodes(me.id);
  run('DELETE FROM sessions WHERE user_id=? AND rowid<>?', me.id, req.sid); // other devices must sign in again with the code
  audit(req.user, '2fa_enabled', 'user', me.id);
  Object.assign(req, upgradeSession(req, res, me, 'ok'), { stage: 'ok' }); // shell() needs the new csrf token
  showCodes(req, res, codes, 'تم تفعيل التحقق بخطوتين.');
});

securityRouter.post('/account/2fa/codes', (req, res) => {
  const me = one('SELECT * FROM users WHERE id=?', req.user.id);
  const s = me.totp_on && verifyTotp(me.totp_secret, req.body.code, me.totp_step);
  if (!s) { flash(res, 'bad', 'رمز التطبيق غير صحيح.'); return res.redirect('/admin/account/2fa'); }
  run('UPDATE users SET totp_step=? WHERE id=?', s, me.id);
  audit(req.user, '2fa_codes', 'user', me.id);
  showCodes(req, res, newRecoveryCodes(me.id), 'أُنشئت رموز استرداد جديدة وأُلغيت القديمة.');
});

securityRouter.post('/account/2fa/disable', (req, res) => {
  const me = one('SELECT * FROM users WHERE id=?', req.user.id);
  if (MFA_ROLES.includes(me.role)) { flash(res, 'bad', 'التحقق بخطوتين إلزامي لصلاحيتك.'); return res.redirect('/admin/account/2fa'); }
  const s = me.totp_on && verifyPassword(String(req.body.password || ''), me.password_hash) && verifyTotp(me.totp_secret, req.body.code, me.totp_step);
  if (!s) { flash(res, 'bad', 'كلمة المرور أو الرمز غير صحيح.'); return res.redirect('/admin/account/2fa'); }
  disableTotp(me.id);
  audit(req.user, '2fa_disabled', 'user', me.id);
  flash(res, 'ok', 'أُوقف التحقق بخطوتين.');
  res.redirect('/admin/account/2fa');
});

// ───────── «جلساتي»
export function describeUA(ua = '') {
  const b = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'متصفح غير معروف';
  const o = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return o ? `${b} على ${o}` : b;
}
const ts = (ms) => (ms ? fmtDate(new Date(ms).toISOString().slice(0, 19).replace('T', ' ')) : '—');

securityRouter.get('/account/sessions', (req, res) => {
  const rows = all("SELECT rowid sid, ip, ua, created_at, last_seen, expires_at FROM sessions WHERE user_id=? AND stage='ok' AND expires_at>? ORDER BY last_seen DESC", req.user.id, Date.now());
  shell(req, res, { title: 'جلساتي', active: '/admin/account', body: html`${pageHead('جلساتي')}
  <section class="card"><p class="hint">الأجهزة المسجّل دخولها إلى حسابك الآن. إن رأيت جهازًا لا تعرفه أنهِ جلسته ثم غيّر كلمة المرور.</p>
  <table class="tbl"><thead><tr><th>الجهاز</th><th>عنوان IP</th><th>بدأت</th><th>آخر نشاط</th><th></th></tr></thead><tbody>
  ${rows.map((s) => html`<tr ${raw(s.sid === req.sid ? 'data-current' : '')}><td>${describeUA(s.ua)}${s.sid === req.sid ? html` <span class="pill s-accepted">هذا الجهاز</span>` : ''}</td><td dir="ltr">${s.ip || '—'}</td><td>${ts(s.created_at)}</td><td>${ts(s.last_seen)}</td>
    <td><form method="post" action="/admin/account/sessions/${s.sid}/end">${csrf(req)}<button class="linkbtn bad" ${raw(s.sid === req.sid ? 'data-confirm="ستُسجَّل خروجك من هذا الجهاز. متابعة؟"' : '')}>إنهاء</button></form></td></tr>`)}</tbody></table>
  ${rows.length > 1 ? html`<form method="post" action="/admin/account/sessions/end-others" class="inline">${csrf(req)}<button class="btn-s" data-confirm="إنهاء كل الجلسات الأخرى؟">إنهاء كل الجلسات الأخرى</button></form>` : ''}</section>` });
});
securityRouter.post('/account/sessions/end-others', (req, res) => {
  const n = run('DELETE FROM sessions WHERE user_id=? AND rowid<>?', req.user.id, req.sid).changes;
  audit(req.user, 'sessions_end', 'user', req.user.id, `أنهى ${n} جلسة`);
  flash(res, 'ok', 'أُنهيت الجلسات الأخرى.');
  res.redirect('/admin/account/sessions');
});
securityRouter.post('/account/sessions/:sid(\\d+)/end', (req, res) => {
  const sid = Number(req.params.sid);
  const n = run('DELETE FROM sessions WHERE rowid=? AND user_id=?', sid, req.user.id).changes; // only own sessions
  if (n) audit(req.user, 'sessions_end', 'user', req.user.id, 'أنهى جلسة');
  if (sid === req.sid) { destroySession(req, res); return res.redirect('/admin/login'); }
  flash(res, 'ok', n ? 'أُنهيت الجلسة.' : 'الجلسة غير موجودة.');
  res.redirect('/admin/account/sessions');
});
