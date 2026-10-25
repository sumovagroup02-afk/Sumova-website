import express from 'express';
import crypto from 'node:crypto';
import { html, raw } from '../html.js';
import { one, all, run, J, tr, getSettings, setSetting, audit } from '../db.js';
import {
  can, ROLES, verifyPassword, hashPassword, createSession, destroySession, requireLogin, requirePerm, csrfGuard,
  throttled, noteFail, clearFails, createUser, setCookie, parseCookies, rand,
} from '../auth.js';
import { auditSeo } from '../seo.js';
import { notify } from '../notify.js';
import { shell, flash, csrf, fld, i18n, readI18n, check, select, fmtDate, pageHead } from './ui.js';
import { contentRouter } from './content.js';
import { requestsRouter } from './requests.js';
import { seoRouter } from './seo.js';
import { securityRouter, stageGate } from './security.js';
import { MFA_ROLES, disableTotp, recoveryLeft } from '../totp.js';
import { STATUS } from '../site/render.js';

export const adminRouter = express.Router();

adminRouter.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.locals.renderForbidden = () => '<!doctype html><meta charset="utf-8"><body dir="rtl" style="font-family:sans-serif;padding:3rem"><h1>لا تملك صلاحية هذه الصفحة</h1><p><a href="/admin">العودة للوحة التحكم</a></p>';
  next();
});

// ───────── login
const loginPage = (res, { token, error = '', email = '' }) => res.type('html').send(html`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>تسجيل الدخول – سوموفا</title><link rel="icon" href="/brand/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/css/site.css"><link rel="stylesheet" href="/css/admin.css?v=1"></head>
<body class="adm login"><main class="login__box"><img src="/brand/logo-ar-onlight.svg" alt="سوموفا" width="170" height="48">
<h1>لوحة التحكم</h1>
<form method="post" action="/admin/login" class="form" autocomplete="on">
  ${error ? html`<div class="notice bad" role="alert">${error}</div>` : ''}
  <input type="hidden" name="lt" value="${token}">
  <div class="fld"><label for="email">البريد الإلكتروني</label><input id="email" name="email" type="email" value="${email}" required autocomplete="username" dir="ltr" autofocus></div>
  <div class="fld"><label for="password">كلمة المرور</label><input id="password" name="password" type="password" required autocomplete="current-password" dir="ltr"></div>
  <button class="btn btn--ink" type="submit">دخول</button>
</form></main></body></html>`.toString());

adminRouter.get('/login', (req, res) => {
  if (req.user && req.stage === 'ok') return res.redirect('/admin');
  const token = rand(18);
  setCookie(res, 'lt', token, { maxAge: 30 * 60 * 1000, path: '/admin' });
  loginPage(res, { token, error: req.query.e === '2fa' ? 'محاولات كثيرة لرمز التحقق. سجّل الدخول من جديد.' : '' });
});
adminRouter.post('/login', (req, res) => {
  const b = req.body || {};
  const tok = parseCookies(req).lt;
  const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
  const key = `${req.ip}|${email}`;
  const again = (error, status = 401) => { const token = rand(18); setCookie(res, 'lt', token, { maxAge: 30 * 60 * 1000, path: '/admin' }); res.status(status); loginPage(res, { token, error, email }); };
  if (!tok || !b.lt || tok.length !== String(b.lt).length || !crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(String(b.lt)))) return again('انتهت صلاحية الصفحة. حاول مرة أخرى.', 403);
  if (throttled(key)) return again('محاولات كثيرة خاطئة. انتظر 15 دقيقة ثم حاول.', 429);
  const u = one('SELECT * FROM users WHERE email=?', email);
  const ok = u && u.active && verifyPassword(String(b.password || ''), u.password_hash);
  if (!u) verifyPassword('x', 'scrypt$00$00'); // keep timing similar
  if (!ok) { noteFail(key); audit(null, 'login_failed', 'user', null, email); return again('البريد الإلكتروني أو كلمة المرور غير صحيحة.'); }
  clearFails(key);
  setCookie(res, 'lt', '', { maxAge: 0, path: '/admin' });
  // password is only step one when 2FA is on (or must be set up for owner/admin)
  if (u.totp_on) { createSession(res, u, req, 'mfa'); return res.redirect('/admin/login/2fa'); }
  if (MFA_ROLES.includes(u.role)) { createSession(res, u, req, 'setup'); audit(u, 'login', 'user', u.id, 'قبل تفعيل التحقق بخطوتين'); return res.redirect('/admin/account/2fa'); }
  createSession(res, u, req);
  audit(u, 'login', 'user', u.id);
  res.redirect('/admin');
});

adminRouter.use(requireLogin, csrfGuard, stageGate);
adminRouter.use('/', securityRouter);

adminRouter.post('/logout', (req, res) => { audit(req.user, 'logout', 'user', req.user.id); destroySession(req, res); res.redirect('/admin/login'); });

// ───────── overview
adminRouter.get('/', (req, res) => {
  const u = req.user, S = getSettings();
  const cards = [];
  let body = html`${pageHead(`أهلًا ${u.name}`)}`;
  const blocks = [];
  if (can(u, 'requests')) {
    const byStatus = Object.fromEntries(all('SELECT status, COUNT(*) n FROM requests GROUP BY status').map((r) => [r.status, r.n]));
    const unseen = one('SELECT COUNT(*) n FROM requests WHERE seen_at IS NULL').n;
    const recent = all('SELECT id,code,kind,name,org,status,created_at,seen_at FROM requests ORDER BY id DESC LIMIT 6');
    blocks.push(html`<section class="card wide2"><div class="card__h"><h2>الطلبات</h2><a href="/admin/requests">كل الطلبات</a></div>
      <div class="stats">${['new', 'pricing', 'quoted', 'accepted'].map((s) => html`<a class="stat" href="/admin/requests?status=${s}"><b>${byStatus[s] || 0}</b><span>${STATUS[s].ar}</span></a>`)}</div>
      ${recent.length ? html`<table class="tbl"><thead><tr><th>الرقم</th><th>العميل</th><th>الحالة</th><th>التاريخ</th></tr></thead><tbody>
        ${recent.map((r) => html`<tr><td><a href="/admin/requests/${r.id}" dir="ltr">${r.code}</a>${r.seen_at ? '' : html` <i class="dot" title="لم يُقرأ"></i>`}</td><td>${r.name}${r.org ? html`<small> – ${r.org}</small>` : ''}</td><td><span class="pill s-${r.status}">${STATUS[r.status]?.ar}</span></td><td>${fmtDate(r.created_at)}</td></tr>`)}</tbody></table>`
        : html`<p class="empty">لا توجد طلبات بعد. ستظهر هنا فور وصولها${unseen ? '' : ''}.</p>`}</section>`);
  }
  if (can(u, 'seo')) {
    const iss = auditSeo();
    const bad = iss.filter((i) => i.level === 'bad').length, warn = iss.filter((i) => i.level === 'warn').length;
    blocks.push(html`<section class="card"><div class="card__h"><h2>صحة محركات البحث</h2><a href="/admin/seo">التقرير</a></div>
      <div class="stats"><div class="stat ${bad ? 'bad' : ''}"><b>${bad}</b><span>مشكلات</span></div><div class="stat ${warn ? 'warn' : ''}"><b>${warn}</b><span>تنبيهات</span></div></div>
      ${bad + warn === 0 ? html`<p class="ok">لا توجد مشكلات ظاهرة.</p>` : html`<ul class="plain">${iss.filter((i) => i.level !== 'info').slice(0, 4).map((i) => html`<li><a href="${i.url}">${i.where}</a>: ${i.msg}</li>`)}</ul>`}</section>`);
  }
  if (can(u, 'settings')) {
    const todo = [];
    if (!S.site?.url) todo.push(['حدّد رابط الموقع الرسمي (مهم للـ SEO وخريطة الموقع)', '/admin/seo#global']);
    if (!S.notifications?.emails && !S.notifications?.webhook_url) todo.push(['فعّل إشعارات الطلبات (بريد أو Webhook)', '/admin/settings#notify']);
    if (!S.analytics?.ga4 && !S.analytics?.search_console) todo.push(['أضف Google Search Console وGA4', '/admin/seo#global']);
    if (!S.contact?.address?.ar) todo.push(['أضف عنوان الشركة وساعات العمل', '/admin/settings#contact']);
    blocks.push(html`<section class="card"><div class="card__h"><h2>قبل الإطلاق</h2></div>${todo.length ? html`<ul class="plain todo">${todo.map(([t, h]) => html`<li><a href="${h}">${t}</a></li>`)}</ul>` : html`<p class="ok">الإعدادات الأساسية مكتملة.</p>`}</section>`);
  }
  if (can(u, 'audit')) {
    const rows = all('SELECT * FROM audit_log ORDER BY id DESC LIMIT 7');
    blocks.push(html`<section class="card"><div class="card__h"><h2>آخر التغييرات</h2><a href="/admin/audit">السجل</a></div><ul class="plain log">${rows.map((r) => html`<li><b>${r.user_name}</b> ${ACTION[r.action] || r.action} ${r.entity ? ENTITY[r.entity] || r.entity : ''}<small>${fmtDate(r.at)}</small></li>`)}</ul></section>`);
  }
  blocks.push(html`<section class="card"><div class="card__h"><h2>اختصارات</h2></div><div class="shortcuts">
    ${can(u, 'pages') ? html`<a href="/admin/pages">تعديل صفحات الموقع</a>` : ''}${can(u, 'media') ? html`<a href="/admin/media">تغيير الصور</a>` : ''}
    ${can(u, 'settings') ? html`<a href="/admin/settings">بيانات الشركة والتواصل</a>` : ''}<a href="/" target="_blank" rel="noopener">فتح الموقع ↗</a></div></section>`);
  shell(req, res, { title: 'نظرة عامة', active: '/admin', body: html`${body}<div class="grid">${blocks}</div>` });
});

export const ACTION = { create: 'أنشأ', update: 'عدّل', delete: 'حذف', login: 'سجّل الدخول', logout: 'سجّل الخروج', login_failed: 'محاولة دخول فاشلة', publish: 'نشر', replace: 'استبدل', status: 'غيّر حالة', quote: 'رفع عرض سعر', webhook_failed: 'فشل Webhook', email_failed: 'فشل بريد', password: 'غيّر كلمة المرور', note: 'أضاف ملاحظة' };
export const ENTITY = { page: 'صفحة', media: 'صورة', product: 'منتج', category: 'تصنيف', request: 'طلب', user: 'مستخدم', settings: 'إعدادات', seo: 'SEO', redirect: 'تحويل', api_key: 'مفتاح API' };

// ───────── audit
adminRouter.get('/audit', requirePerm('audit'), (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  const rows = q ? all("SELECT * FROM audit_log WHERE user_name LIKE ? OR action LIKE ? OR entity LIKE ? OR detail LIKE ? ORDER BY id DESC LIMIT 300", ...Array(4).fill(`%${q}%`)) : all('SELECT * FROM audit_log ORDER BY id DESC LIMIT 300');
  shell(req, res, { title: 'سجل التغييرات', active: '/admin/audit', body: html`${pageHead('سجل التغييرات')}
    <form class="inline" method="get"><input name="q" value="${q}" placeholder="بحث بالاسم أو الإجراء" aria-label="بحث"><button class="btn-s">بحث</button></form>
    <table class="tbl"><thead><tr><th>الوقت</th><th>المستخدم</th><th>الإجراء</th><th>التفاصيل</th></tr></thead><tbody>
    ${rows.map((r) => html`<tr><td>${fmtDate(r.at)}</td><td>${r.user_name}</td><td>${ACTION[r.action] || r.action} ${r.entity ? ENTITY[r.entity] || r.entity : ''}${r.entity_id ? html` <small dir="ltr">#${r.entity_id}</small>` : ''}</td><td>${r.detail || ''}</td></tr>`)}</tbody></table>
    ${rows.length ? '' : html`<p class="empty">لا توجد نتائج.</p>`}` });
});

// ───────── settings
const SOCIAL = ['LinkedIn', 'Instagram', 'YouTube', 'TikTok', 'Snapchat', 'X'];
adminRouter.get('/settings', requirePerm('settings'), (req, res) => {
  const S = getSettings(), ct = S.contact || {}, br = S.brand || {}, so = S.social || {}, nt = S.notifications || {}, sm = S.smtp || {};
  shell(req, res, { title: 'الإعدادات', active: '/admin/settings', body: html`${pageHead('الإعدادات')}
  <form method="post" action="/admin/settings" class="stack">${csrf(req)}
  <section class="card" id="brand"><div class="card__h"><h2>الهوية</h2></div>
    ${i18n('brand_name', 'اسم الشركة', br.name)}${fld('brand_cr', 'رقم السجل التجاري', br.cr, { dir: 'ltr' })}
    ${i18n('footer_about', 'نبذة أسفل الموقع', S.footer?.about, { area: true, rows: 3 })}</section>
  <section class="card" id="contact"><div class="card__h"><h2>بيانات التواصل</h2></div>
    <div class="cols">${fld('contact_phone', 'الجوال', ct.phone, { dir: 'ltr', type: 'tel' })}${fld('contact_email', 'البريد الإلكتروني', ct.email, { dir: 'ltr', type: 'email' })}</div>
    ${fld('contact_whatsapp', 'رقم واتساب الأعمال', ct.whatsapp, { dir: 'ltr', type: 'tel', hint: 'يظهر زر واتساب في صفحة التواصل وزر عائم على الجوال. اتركه فارغًا لإخفائهما.' })}
    ${i18n('contact_address', 'العنوان', ct.address, { area: true, rows: 2 })}${fld('contact_map', 'رابط الموقع على الخريطة', ct.map_url, { dir: 'ltr', type: 'url', hint: 'يظهر في صفحة التواصل. استخدم رابطًا بالإحداثيات حتى لا يظهر اسم قديم للمكان في الخرائط.' })}${i18n('contact_hours', 'ساعات العمل', ct.hours)}</section>
  <section class="card" id="social"><div class="card__h"><h2>الحسابات الاجتماعية</h2></div><div class="cols">
    ${SOCIAL.map((k) => fld('social_' + k, k, so[k] || '', { dir: 'ltr', type: 'url', attrs: 'placeholder="https://"' }))}</div></section>
  <section class="card" id="notify"><div class="card__h"><h2>إشعارات الطلبات</h2></div>
    <p class="hint">عند وصول طلب جديد أو قبول/رفض عرض يُرسل إشعار إلى هذه القنوات. فشل الإشعار لا يعطّل استلام الطلب.</p>
    ${fld('n_emails', 'بريد الموظفين (افصل بفاصلة)', nt.emails, { dir: 'ltr' })}
    <div class="cols">${fld('n_webhook_url', 'رابط Webhook (مثل n8n)', nt.webhook_url, { dir: 'ltr', type: 'url' })}${fld('n_webhook_secret', 'مفتاح توقيع Webhook (اختياري)', nt.webhook_secret, { dir: 'ltr' })}</div></section>
  <section class="card" id="smtp"><div class="card__h"><h2>خادم البريد (SMTP)</h2></div>
    <p class="hint">بريد الشركة على Zoho Mail: الخادم <code dir="ltr">smtppro.zoho.com</code>، المنفذ <code dir="ltr">465</code> مع «اتصال مشفّر مباشر» (أو <code dir="ltr">587</code> بدونه). إن كان التحقق بخطوتين مفعّلًا في Zoho فاستخدم «كلمة مرور خاصة بالتطبيق» من إعدادات حساب Zoho. لا يُرسل البريد قبل حفظ كلمة المرور.</p><div class="cols">
    ${fld('smtp_host', 'الخادم', sm.host, { dir: 'ltr' })}${fld('smtp_port', 'المنفذ', sm.port || '587', { dir: 'ltr' })}
    ${fld('smtp_user', 'المستخدم', sm.user, { dir: 'ltr' })}${fld('smtp_pass', 'كلمة المرور', sm.pass ? '••••••••' : '', { type: 'password', dir: 'ltr', hint: sm.pass ? 'اتركها كما هي للإبقاء على الحالية.' : '' })}
    ${fld('smtp_from', 'عنوان المرسل', sm.from, { dir: 'ltr' })}<div class="f"><span class="lbl">الاتصال</span>${check('smtp_secure', 'اتصال مشفّر مباشر (SSL، منفذ 465)', sm.secure)}</div></div></section>
  <div class="savebar"><button class="btn btn--ink">حفظ الإعدادات</button></div></form>
  <section class="card"><div class="card__h"><h2>اختبار الإشعارات</h2></div><form method="post" action="/admin/settings/test" class="inline">${csrf(req)}<button class="btn-s">أرسل إشعارًا تجريبيًا</button><small>يرسل حدثًا باسم test.ping إلى البريد وWebhook المحفوظين.</small></form></section>` });
});
adminRouter.post('/settings', requirePerm('settings'), (req, res) => {
  const b = req.body, S = getSettings();
  const t = (k, n = 300) => String(b[k] ?? '').trim().slice(0, n);
  const url = (k) => { const v = t(k, 400); return /^https?:\/\//i.test(v) ? v : ''; };
  setSetting('brand', { ...(S.brand || {}), name: readI18n(b, 'brand_name', 80), cr: t('brand_cr', 30) });
  setSetting('footer', { ...(S.footer || {}), about: readI18n(b, 'footer_about', 600) });
  setSetting('contact', { ...(S.contact || {}), phone: t('contact_phone', 30), whatsapp: 'contact_whatsapp' in b ? t('contact_whatsapp', 30) : S.contact?.whatsapp || '', email: /^[^@\s]+@[^@\s]+$/.test(t('contact_email')) ? t('contact_email') : '', address: readI18n(b, 'contact_address', 300), hours: readI18n(b, 'contact_hours', 200), map_url: url('contact_map'), geo: (() => { const g = /(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/.exec(url('contact_map')); return g ? { lat: Number(g[1]), lng: Number(g[2]) } : null; })() });
  setSetting('social', Object.fromEntries(SOCIAL.map((k) => [k, url('social_' + k)]).filter(([, v]) => v)));
  setSetting('notifications', { emails: t('n_emails', 400), webhook_url: url('n_webhook_url'), webhook_secret: t('n_webhook_secret', 120) });
  const pass = t('smtp_pass', 200);
  setSetting('smtp', { host: t('smtp_host', 200), port: t('smtp_port', 6), user: t('smtp_user', 200), pass: pass === '••••••••' ? S.smtp?.pass || '' : pass, from: t('smtp_from', 200), secure: b.smtp_secure === '1' });
  audit(req.user, 'update', 'settings', null, 'الإعدادات العامة');
  flash(res, 'ok', 'تم حفظ الإعدادات.');
  res.redirect('/admin/settings');
});
adminRouter.post('/settings/test', requirePerm('settings'), (req, res) => {
  notify('test.ping', { by: req.user.email }, { subject: 'اختبار إشعارات موقع سوموفا', text: 'وصلت هذه الرسالة من لوحة التحكم.' });
  flash(res, 'ok', 'أُرسل الإشعار التجريبي. إن لم يصل خلال دقيقة راجع «سجل التغييرات» لمعرفة سبب الفشل.');
  res.redirect('/admin/settings');
});

// ───────── account (own password/name)
adminRouter.get('/account', (req, res) => {
  const me = one('SELECT * FROM users WHERE id=?', req.user.id);
  shell(req, res, { title: 'حسابي', active: '/admin/account', body: html`${pageHead('حسابي')}
  <form method="post" action="/admin/account" class="card stack narrow">${csrf(req)}
    ${fld('name', 'الاسم', me.name, { req: true })}
    <div class="f"><span class="lbl">البريد</span><b dir="ltr">${me.email}</b></div><div class="f"><span class="lbl">الصلاحية</span><b>${ROLES[me.role]?.label}</b></div>
    <hr>${fld('current', 'كلمة المرور الحالية (لتغييرها فقط)', '', { type: 'password', dir: 'ltr', attrs: 'autocomplete="current-password"' })}
    ${fld('next', 'كلمة المرور الجديدة', '', { type: 'password', dir: 'ltr', hint: '10 أحرف على الأقل.', attrs: 'autocomplete="new-password" minlength="10"' })}
    <button class="btn btn--ink">حفظ</button></form>
  <section class="card narrow"><div class="card__h"><h2>الأمان</h2></div><ul class="plain">
    <li><a href="/admin/account/2fa">التحقق بخطوتين</a>: ${me.totp_on ? html`<b>مفعّل</b> (رموز استرداد متبقية: ${recoveryLeft(me.id)})` : html`<b>غير مفعّل</b>${MFA_ROLES.includes(me.role) ? ' – إلزامي لصلاحيتك' : ''}`}</li>
    <li><a href="/admin/account/sessions">جلساتي</a>: الأجهزة المسجّل دخولها وإنهاؤها</li></ul></section>` });
});
adminRouter.post('/account', (req, res) => {
  const me = one('SELECT * FROM users WHERE id=?', req.user.id), b = req.body;
  const name = String(b.name || '').trim().slice(0, 80);
  if (!name) { flash(res, 'bad', 'الاسم مطلوب.'); return res.redirect('/admin/account'); }
  run('UPDATE users SET name=? WHERE id=?', name, me.id);
  if (b.next) {
    if (!verifyPassword(String(b.current || ''), me.password_hash)) { flash(res, 'bad', 'كلمة المرور الحالية غير صحيحة.'); return res.redirect('/admin/account'); }
    if (String(b.next).length < 10) { flash(res, 'bad', 'كلمة المرور الجديدة قصيرة (10 أحرف على الأقل).'); return res.redirect('/admin/account'); }
    run('UPDATE users SET password_hash=? WHERE id=?', hashPassword(String(b.next)), me.id);
    run('DELETE FROM sessions WHERE user_id=? AND csrf<>?', me.id, req.csrf); // sign out other devices
    audit(req.user, 'password', 'user', me.id);
  }
  flash(res, 'ok', 'تم الحفظ.');
  res.redirect('/admin/account');
});

// ───────── users (owner)
adminRouter.get('/users', requirePerm('users'), (req, res) => {
  const rows = all('SELECT * FROM users ORDER BY id');
  shell(req, res, { title: 'المستخدمون', active: '/admin/users', body: html`${pageHead('المستخدمون')}
  <table class="tbl"><thead><tr><th>الاسم</th><th>البريد</th><th>الصلاحية</th><th>الحالة</th><th>التحقق بخطوتين</th><th>آخر دخول</th><th></th></tr></thead><tbody>
  ${rows.map((u) => html`<tr><td>${u.name}</td><td dir="ltr">${u.email}</td><td>${ROLES[u.role]?.label}</td><td>${u.active ? 'نشط' : 'موقوف'}</td><td>${u.totp_on ? 'مفعّل' : MFA_ROLES.includes(u.role) ? 'لم يُفعَّل (إلزامي)' : '—'}</td><td>${fmtDate(u.last_login) || '—'}</td><td><a href="/admin/users/${u.id}">تعديل</a></td></tr>`)}</tbody></table>
  <section class="card narrow"><div class="card__h"><h2>إضافة مستخدم</h2></div><form method="post" action="/admin/users" class="stack">${csrf(req)}
    ${fld('name', 'الاسم', '', { req: true })}${fld('email', 'البريد الإلكتروني', '', { req: true, type: 'email', dir: 'ltr' })}
    ${fld('password', 'كلمة مرور مؤقتة', '', { req: true, type: 'password', dir: 'ltr', hint: '10 أحرف على الأقل. يغيّرها المستخدم من «حسابي».', attrs: 'minlength="10" autocomplete="new-password"' })}
    ${select('role', 'الصلاحية', Object.entries(ROLES).map(([k, v]) => [k, v.label]), 'editor')}
    <p class="hint">محرر المحتوى: الصفحات والصور والمنتجات وSEO. المبيعات: الطلبات فقط. المدير: كل شيء عدا المستخدمين والربط.</p>
    <button class="btn btn--ink">إضافة</button></form></section>` });
});
adminRouter.post('/users', requirePerm('users'), (req, res) => {
  const b = req.body, email = String(b.email || '').trim().toLowerCase();
  if (!String(b.name || '').trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || String(b.password || '').length < 10 || !ROLES[b.role]) { flash(res, 'bad', 'تحقق من الاسم والبريد وكلمة المرور (10 أحرف) والصلاحية.'); return res.redirect('/admin/users'); }
  if (one('SELECT 1 x FROM users WHERE email=?', email)) { flash(res, 'bad', 'هذا البريد مسجّل بالفعل.'); return res.redirect('/admin/users'); }
  createUser({ email, name: String(b.name).trim().slice(0, 80), password: String(b.password), role: b.role }, req.user);
  flash(res, 'ok', 'تمت إضافة المستخدم.');
  res.redirect('/admin/users');
});
adminRouter.get('/users/:id(\\d+)', requirePerm('users'), (req, res) => {
  const u = one('SELECT * FROM users WHERE id=?', req.params.id);
  if (!u) return res.redirect('/admin/users');
  const self = u.id === req.user.id;
  shell(req, res, { title: u.name, active: '/admin/users', body: html`${pageHead(u.name)}
  <form method="post" action="/admin/users/${u.id}" class="card stack narrow">${csrf(req)}
    ${fld('name', 'الاسم', u.name, { req: true })}<div class="f"><span class="lbl">البريد</span><b dir="ltr">${u.email}</b></div>
    ${self ? html`<div class="f"><span class="lbl">الصلاحية</span><b>${ROLES[u.role]?.label}</b><small>لا يمكنك تغيير صلاحية حسابك.</small></div>` : select('role', 'الصلاحية', Object.entries(ROLES).map(([k, v]) => [k, v.label]), u.role)}
    ${self ? '' : check('active', 'الحساب نشط', u.active)}
    ${fld('password', 'كلمة مرور جديدة (اتركها فارغة لعدم التغيير)', '', { type: 'password', dir: 'ltr', attrs: 'minlength="10" autocomplete="new-password"' })}
    <button class="btn btn--ink">حفظ</button> <a href="/admin/users">رجوع</a></form>
  <section class="card narrow"><div class="card__h"><h2>التحقق بخطوتين</h2></div>
    <p>${u.totp_on ? 'مفعّل.' : 'غير مفعّل.'}${MFA_ROLES.includes(u.role) ? ' إلزامي لهذه الصلاحية.' : ''}</p>
    ${u.totp_on && !self ? html`<form method="post" action="/admin/users/${u.id}/reset-2fa">${csrf(req)}<p class="hint">استخدمها إذا فقد المستخدم جواله ورموز الاسترداد. تُنهى جلساته، ويُطلب منه إعداد التحقق من جديد${MFA_ROLES.includes(u.role) ? ' عند دخوله التالي' : ''}.</p>
      <button class="linkbtn bad" data-confirm="إعادة ضبط التحقق بخطوتين لهذا المستخدم؟">إعادة ضبط التحقق بخطوتين</button></form>` : ''}
    ${u.totp_on && self ? html`<p class="hint">لا يمكنك إعادة ضبط تحققك بنفسك. يديره كل مستخدم من «حسابي».</p>` : ''}</section>` });
});
adminRouter.post('/users/:id(\\d+)/reset-2fa', requirePerm('users'), (req, res) => {
  const u = one('SELECT * FROM users WHERE id=?', req.params.id);
  if (!u || u.id === req.user.id) return res.redirect('/admin/users');
  disableTotp(u.id);
  run('DELETE FROM sessions WHERE user_id=?', u.id);
  audit(req.user, '2fa_reset', 'user', u.id, u.email);
  flash(res, 'ok', 'أُعيد ضبط التحقق بخطوتين وأُنهيت جلسات المستخدم.');
  res.redirect('/admin/users/' + u.id);
});
adminRouter.post('/users/:id(\\d+)', requirePerm('users'), (req, res) => {
  const u = one('SELECT * FROM users WHERE id=?', req.params.id), b = req.body;
  if (!u) return res.redirect('/admin/users');
  const self = u.id === req.user.id;
  const role = self ? u.role : (ROLES[b.role] ? b.role : u.role), active = self ? 1 : (b.active === '1' ? 1 : 0);
  if (!self && u.role === 'owner' && (role !== 'owner' || !active) && one("SELECT COUNT(*) n FROM users WHERE role='owner' AND active=1").n < 2) { flash(res, 'bad', 'يجب أن يبقى مالك واحد نشط على الأقل.'); return res.redirect('/admin/users/' + u.id); }
  run('UPDATE users SET name=?, role=?, active=? WHERE id=?', String(b.name || u.name).trim().slice(0, 80), role, active, u.id);
  if (b.password) {
    if (String(b.password).length < 10) { flash(res, 'bad', 'كلمة المرور قصيرة (10 أحرف على الأقل).'); return res.redirect('/admin/users/' + u.id); }
    run('UPDATE users SET password_hash=? WHERE id=?', hashPassword(String(b.password)), u.id);
    run('DELETE FROM sessions WHERE user_id=?', u.id);
    audit(req.user, 'password', 'user', u.id);
  }
  if (!active || role !== u.role) run('DELETE FROM sessions WHERE user_id=?', u.id);
  audit(req.user, 'update', 'user', u.id, `${u.email} → ${role}${active ? '' : ' (موقوف)'}`);
  flash(res, 'ok', 'تم الحفظ.');
  res.redirect('/admin/users');
});

// ───────── integrations / API keys (owner)
import { sha } from '../auth.js';
adminRouter.get('/integrations', requirePerm('integrations'), (req, res) => {
  const keys = all('SELECT * FROM api_keys ORDER BY id DESC');
  const fresh = parseCookies(req).newkey;
  if (fresh) setCookie(res, 'newkey', '', { maxAge: 0, path: '/admin' });
  const base = `${req.protocol}://${req.get('host')}`;
  shell(req, res, { title: 'الربط والـ API', active: '/admin/integrations', body: html`${pageHead('الربط والـ API')}
  ${fresh ? html`<div class="notice"><b>انسخ المفتاح الآن، لن يظهر مرة أخرى:</b><br><code class="key" dir="ltr">${fresh}</code></div>` : ''}
  <section class="card"><div class="card__h"><h2>مفاتيح API</h2></div>
  ${keys.length ? html`<table class="tbl"><thead><tr><th>الاسم</th><th>أُنشئ</th><th>آخر استخدام</th><th></th></tr></thead><tbody>${keys.map((k) => html`<tr><td>${k.name}</td><td>${fmtDate(k.created_at)}</td><td>${fmtDate(k.last_used) || '—'}</td><td><form method="post" action="/admin/integrations/${k.id}/revoke">${csrf(req)}<button class="linkbtn bad" data-confirm="إلغاء هذا المفتاح نهائيًا؟">إلغاء</button></form></td></tr>`)}</tbody></table>` : html`<p class="empty">لا توجد مفاتيح.</p>`}
  <form method="post" action="/admin/integrations" class="inline">${csrf(req)}<input name="name" placeholder="اسم المفتاح (مثل n8n)" required maxlength="60" aria-label="اسم المفتاح"><button class="btn-s">إنشاء مفتاح</button></form></section>
  <section class="card"><div class="card__h"><h2>كيف تستخدمه</h2></div>
  <p>أرسل المفتاح في الترويسة <code dir="ltr">Authorization: Bearer …</code></p>
  <ul class="plain code" dir="ltr"><li><code>GET ${base}/api/v1/requests?status=new&amp;since=2026-01-01</code></li><li><code>GET ${base}/api/v1/requests/R-ABC123</code></li><li><code>PATCH ${base}/api/v1/requests/R-ABC123</code> {"status":"pricing","note":"…"}</li></ul>
  <p>أحداث Webhook الصادرة (من «الإعدادات»): <code dir="ltr">request.created</code> · <code dir="ltr">request.quoted</code> · <code dir="ltr">request.decision</code> · <code dir="ltr">test.ping</code>. يُرسل التوقيع في <code dir="ltr">x-sumova-signature</code> (HMAC-SHA256 للجسم).</p></section>` });
});
adminRouter.post('/integrations', requirePerm('integrations'), (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (!name) return res.redirect('/admin/integrations');
  const key = 'smv_' + rand(30);
  run('INSERT INTO api_keys(name,key_hash) VALUES(?,?)', name, sha(key));
  audit(req.user, 'create', 'api_key', null, name);
  setCookie(res, 'newkey', key, { maxAge: 60000, path: '/admin' });
  res.redirect('/admin/integrations');
});
adminRouter.post('/integrations/:id(\\d+)/revoke', requirePerm('integrations'), (req, res) => {
  run('DELETE FROM api_keys WHERE id=?', req.params.id);
  audit(req.user, 'delete', 'api_key', req.params.id);
  flash(res, 'ok', 'أُلغي المفتاح.');
  res.redirect('/admin/integrations');
});

adminRouter.use('/', contentRouter);
adminRouter.use('/requests', requestsRouter);
adminRouter.use('/seo', seoRouter);

adminRouter.use((req, res) => shell(req, res, { title: 'غير موجود', body: html`${pageHead('الصفحة غير موجودة')}<p><a href="/admin">العودة للنظرة العامة</a></p>` }));
