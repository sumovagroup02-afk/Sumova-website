import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { html } from '../html.js';
import { one, all, run, tx, J, PRIVATE_DIR, audit } from '../db.js';
import { requirePerm, guardAfterUpload } from '../auth.js';
import { notify } from '../notify.js';
import { STATUS } from '../site/render.js';
import { shell, flash, csrf, fmtDate, pageHead, select } from './ui.js';

export const requestsRouter = express.Router();
requestsRouter.use(requirePerm('requests'));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 10 } });
const KIND = { quote: 'عرض سعر', catering: 'إعاشة', contact: 'رسالة تواصل' };
const FLOW = ['new', 'pricing', 'quoted', 'accepted', 'rejected', 'confirmed', 'closed'];
const EVT = { created: 'وصل الطلب', note: 'ملاحظة', quote: 'رُفع عرض السعر', accepted: 'العميل قبل العرض', rejected: 'العميل رفض العرض', assigned: 'إسناد', status: 'تغيير الحالة' };

const ev = (id, actor, type, note) => run('INSERT INTO request_events(request_id,actor,type,note) VALUES(?,?,?,?)', id, actor, type, note ?? null);
const wa = (phone) => { const d = String(phone).replace(/\D/g, ''); return d.startsWith('0') ? '966' + d.slice(1) : d.length === 9 ? '966' + d : d; };

requestsRouter.get('/', (req, res) => {
  const { status = '', kind = '', q = '' } = req.query;
  const where = [], args = [];
  if (STATUS[status]) { where.push('r.status=?'); args.push(status); }
  if (KIND[kind]) { where.push('r.kind=?'); args.push(kind); }
  const qq = String(q).trim().slice(0, 60);
  if (qq) { where.push('(r.code LIKE ? OR r.name LIKE ? OR r.org LIKE ? OR r.phone LIKE ? OR r.email LIKE ?)'); args.push(...Array(5).fill(`%${qq}%`)); }
  const rows = all(`SELECT r.*, u.name aname FROM requests r LEFT JOIN users u ON u.id=r.assigned_to ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.id DESC LIMIT 300`, ...args);
  const counts = Object.fromEntries(all('SELECT status, COUNT(*) n FROM requests GROUP BY status').map((r) => [r.status, r.n]));
  shell(req, res, { title: 'الطلبات', active: '/admin/requests', wide: true, body: html`${pageHead('الطلبات', html`<a class="btn-s" href="/admin/requests/export.csv?${new URLSearchParams({ status, kind, q: qq })}">تصدير CSV</a>`)}
  <nav class="tabs" aria-label="تصفية بالحالة"><a href="/admin/requests" ${status ? '' : html`aria-current="page"`}>الكل</a>${FLOW.map((s) => html`<a href="/admin/requests?status=${s}" ${status === s ? html`aria-current="page"` : ''}>${STATUS[s].ar} <b>${counts[s] || 0}</b></a>`)}</nav>
  <form class="inline" method="get">${status ? html`<input type="hidden" name="status" value="${status}">` : ''}
    <select name="kind" aria-label="النوع"><option value="">كل الأنواع</option>${Object.entries(KIND).map(([k, v]) => html`<option value="${k}" ${kind === k ? 'selected' : ''}>${v}</option>`)}</select>
    <input name="q" value="${qq}" placeholder="رقم الطلب أو الاسم أو الجوال" aria-label="بحث"><button class="btn-s">بحث</button></form>
  ${rows.length ? html`<table class="tbl"><thead><tr><th>الرقم</th><th>النوع</th><th>العميل</th><th>الجوال</th><th>الحالة</th><th>المسؤول</th><th>التاريخ</th></tr></thead><tbody>
  ${rows.map((r) => html`<tr class="${r.seen_at ? '' : 'unseen'}"><td><a href="/admin/requests/${r.id}" dir="ltr"><b>${r.code}</b></a></td><td>${KIND[r.kind]}</td><td>${r.name}${r.org ? html`<small> – ${r.org}</small>` : ''}</td><td dir="ltr">${r.phone}</td><td><span class="pill s-${r.status}">${STATUS[r.status]?.ar}</span></td><td>${r.aname || '—'}</td><td>${fmtDate(r.created_at)}</td></tr>`)}</tbody></table>`
    : html`<p class="empty">${qq || status || kind ? 'لا توجد طلبات مطابقة.' : 'لم يصل أي طلب بعد. عند وصول أول طلب سيظهر هنا وتصلك رسالة إن فعّلت الإشعارات.'}</p>`}` });
});

requestsRouter.get('/export.csv', (req, res) => {
  const { status = '', kind = '', q = '' } = req.query;
  const where = [], args = [];
  if (STATUS[status]) { where.push('status=?'); args.push(status); }
  if (KIND[kind]) { where.push('kind=?'); args.push(kind); }
  if (String(q).trim()) { where.push('(code LIKE ? OR name LIKE ? OR org LIKE ? OR phone LIKE ? OR email LIKE ?)'); args.push(...Array(5).fill(`%${String(q).trim().slice(0, 60)}%`)); }
  const rows = all(`SELECT * FROM requests ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 5000`, ...args);
  // neutralise spreadsheet formula injection (=,+,-,@ at the start of a cell)
  const cell = (v) => { let s = String(v ?? '').replace(/\r?\n/g, ' '); if (/^[=+\-@\t]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  const head = ['الرقم', 'النوع', 'الاسم', 'الجهة', 'الجوال', 'البريد', 'الحالة', 'الرسالة', 'المنتجات', 'التاريخ'];
  const lines = [head.map(cell).join(',')].concat(rows.map((r) => [r.code, KIND[r.kind], r.name, r.org, r.phone, r.email, STATUS[r.status]?.ar, r.message, J(r.items, []).map((i) => `${i.name}×${i.qty}`).join('؛ '), r.created_at].map(cell).join(',')));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="sumova-requests.csv"');
  res.send('﻿' + lines.join('\r\n'));
});

requestsRouter.get('/:id(\\d+)', (req, res) => {
  const r = one('SELECT * FROM requests WHERE id=?', req.params.id);
  if (!r) return res.redirect('/admin/requests');
  if (!r.seen_at) run("UPDATE requests SET seen_at=datetime('now') WHERE id=?", r.id);
  const items = J(r.items, []), extra = J(r.extra, {}), files = J(r.files, []);
  const events = all('SELECT * FROM request_events WHERE request_id=? ORDER BY id DESC', r.id);
  const staff = all('SELECT id,name FROM users WHERE active=1 AND role IN (\'owner\',\'admin\',\'sales\') ORDER BY name');
  shell(req, res, { title: r.code, active: '/admin/requests', wide: true, body: html`
  <div class="phd"><h1><span dir="ltr">${r.code}</span> <span class="pill s-${r.status}">${STATUS[r.status]?.ar}</span></h1><div class="acts"><a class="btn-s" href="/admin/requests">رجوع</a></div></div>
  <div class="editor"><div class="editor__main">
   <section class="card"><div class="card__h"><h2>بيانات العميل</h2></div><dl class="dl">
     <dt>النوع</dt><dd>${KIND[r.kind]}</dd><dt>الاسم</dt><dd>${r.name}</dd>${r.org ? html`<dt>الجهة</dt><dd>${r.org}</dd>` : ''}
     <dt>الجوال</dt><dd dir="ltr"><a href="tel:${r.phone}">${r.phone}</a> · <a href="https://wa.me/${wa(r.phone)}" target="_blank" rel="noopener">واتساب ↗</a></dd>
     ${r.email ? html`<dt>البريد</dt><dd dir="ltr"><a href="mailto:${r.email}">${r.email}</a></dd>` : ''}<dt>وصل في</dt><dd>${fmtDate(r.created_at)}</dd></dl></section>
   ${r.kind === 'catering' ? html`<section class="card"><div class="card__h"><h2>تفاصيل الإعاشة</h2></div><dl class="dl"><dt>عدد الأشخاص</dt><dd>${extra.people || '—'}</dd><dt>عدد الأيام</dt><dd>${extra.days || '—'}</dd><dt>الموقع</dt><dd>${extra.place || '—'}</dd><dt>تاريخ البدء</dt><dd dir="ltr">${extra.start || '—'}</dd></dl></section>` : ''}
   ${items.length ? html`<section class="card"><div class="card__h"><h2>المنتجات المطلوبة</h2></div><table class="tbl"><thead><tr><th>المنتج</th><th>الخيار</th><th>الكمية</th></tr></thead><tbody>${items.map((i) => html`<tr><td>${i.name}</td><td>${i.opt || '—'}</td><td>${i.qty}</td></tr>`)}</tbody></table></section>` : ''}
   ${r.message ? html`<section class="card"><div class="card__h"><h2>الرسالة</h2></div><p class="pre">${r.message}</p></section>` : ''}
   ${files.length ? html`<section class="card"><div class="card__h"><h2>ملفات العميل</h2></div><ul class="plain">${files.map((f, i) => html`<li><a href="/admin/requests/${r.id}/file/${i}">${f.name}</a> <small>${Math.round(f.size / 1024)} KB</small></li>`)}</ul></section>` : ''}
   <section class="card"><div class="card__h"><h2>السجل</h2></div><ol class="timeline">${events.map((e) => html`<li><b>${EVT[e.type] || e.type}</b> <small>${e.actor === 'customer' ? 'العميل' : e.actor} · ${fmtDate(e.at)}</small>${e.note ? html`<p>${e.note}</p>` : ''}</li>`)}</ol></section>
  </div>
  <aside class="editor__side">
   <form class="card stack" method="post" action="/admin/requests/${r.id}/status">${csrf(req)}<div class="card__h"><h2>الحالة</h2></div>
     ${select('status', 'الحالة الحالية', FLOW.map((s) => [s, STATUS[s].ar]), r.status)}
     <div class="f"><label for="snote">ملاحظة (اختياري)</label><textarea id="snote" name="note" rows="2" maxlength="500"></textarea></div><button class="btn btn--ink">تحديث الحالة</button>
     <p class="hint">«أُرسل العرض» يتم تلقائيًا عند رفع ملف عرض السعر. قبول العميل أو رفضه يصل منه مباشرة، ويمكنك تسجيله يدويًا إن أبلغك هاتفيًا.</p></form>
   <form class="card stack" method="post" action="/admin/requests/${r.id}/assign">${csrf(req)}<div class="card__h"><h2>المسؤول</h2></div>
     ${select('assigned_to', 'إسناد إلى', [['', 'بدون'], ...staff.map((u) => [u.id, u.name])], r.assigned_to ?? '')}<button class="btn-s">حفظ</button></form>
   <form class="card stack" method="post" action="/admin/requests/${r.id}/quote" enctype="multipart/form-data"><div class="card__h"><h2>عرض السعر (PDF)</h2></div>
     ${r.quote_file ? html`<p>الملف الحالي: <a href="/admin/requests/${r.id}/quote">${r.quote_name || 'عرض السعر.pdf'}</a><br><small>أُرسل ${fmtDate(r.quote_sent_at)}</small></p>` : html`<p class="hint">ارفع ملف العرض ليظهر للعميل في صفحة تتبع الطلب ويمكنه قبوله أو رفضه.</p>`}
     <input type="hidden" name="_csrf" value="${req.csrf}"><input type="file" name="file" accept="application/pdf,.pdf" required aria-label="ملف العرض"><button class="btn btn--gold">${r.quote_file ? 'استبدال وإعادة الإرسال' : 'رفع وإرسال للعميل'}</button></form>
   <form class="card stack" method="post" action="/admin/requests/${r.id}/note">${csrf(req)}<div class="card__h"><h2>ملاحظة داخلية</h2></div><textarea name="note" rows="3" maxlength="800" required aria-label="ملاحظة"></textarea><button class="btn-s">إضافة</button><p class="hint">لا تظهر للعميل.</p></form>
   ${req.user.role === 'owner' || req.user.role === 'admin' ? html`<form class="card" method="post" action="/admin/requests/${r.id}/delete">${csrf(req)}<button class="btn-s bad" data-confirm="حذف الطلب نهائيًا؟">حذف الطلب</button></form>` : ''}
  </aside></div>` });
});

requestsRouter.post('/:id(\\d+)/status', (req, res) => {
  const r = one('SELECT * FROM requests WHERE id=?', req.params.id);
  if (!r) return res.redirect('/admin/requests');
  const st = req.body.status;
  if (!FLOW.includes(st)) { flash(res, 'bad', 'حالة غير صالحة.'); return res.redirect('/admin/requests/' + r.id); }
  if (st === 'quoted' && !r.quote_file) { flash(res, 'bad', 'ارفع ملف عرض السعر أولًا ليتحول الطلب إلى «أُرسل العرض».'); return res.redirect('/admin/requests/' + r.id); }
  if (st !== r.status) {
    tx(() => {
      run("UPDATE requests SET status=?, updated_at=datetime('now') WHERE id=?", st, r.id);
      ev(r.id, req.user.name, 'status', `${STATUS[r.status]?.ar} ← ${STATUS[st].ar}${req.body.note ? ' – ' + String(req.body.note).slice(0, 500) : ''}`);
    });
    audit(req.user, 'status', 'request', r.id, `${r.code}: ${st}`);
    notify('request.status', { id: r.id, code: r.code, status: st, name: r.name, phone: r.phone, email: r.email });
  } else if (req.body.note) ev(r.id, req.user.name, 'note', String(req.body.note).slice(0, 500));
  flash(res, 'ok', 'تم تحديث الحالة.');
  res.redirect('/admin/requests/' + r.id);
});
requestsRouter.post('/:id(\\d+)/assign', (req, res) => {
  const r = one('SELECT * FROM requests WHERE id=?', req.params.id);
  if (!r) return res.redirect('/admin/requests');
  const uid = parseInt(req.body.assigned_to, 10) || null, u = uid ? one('SELECT * FROM users WHERE id=? AND active=1', uid) : null;
  run("UPDATE requests SET assigned_to=?, updated_at=datetime('now') WHERE id=?", u ? u.id : null, r.id);
  ev(r.id, req.user.name, 'assigned', u ? u.name : 'بدون مسؤول');
  flash(res, 'ok', 'تم الإسناد.');
  res.redirect('/admin/requests/' + r.id);
});
requestsRouter.post('/:id(\\d+)/note', (req, res) => {
  const r = one('SELECT id FROM requests WHERE id=?', req.params.id), n = String(req.body.note || '').trim().slice(0, 800);
  if (r && n) { ev(r.id, req.user.name, 'note', n); audit(req.user, 'note', 'request', r.id); flash(res, 'ok', 'أُضيفت الملاحظة.'); }
  res.redirect('/admin/requests/' + req.params.id);
});
requestsRouter.post('/:id(\\d+)/quote', upload.single('file'), guardAfterUpload, (req, res) => {
  const r = one('SELECT * FROM requests WHERE id=?', req.params.id);
  if (!r) return res.redirect('/admin/requests');
  const f = req.file;
  if (!f || f.buffer.subarray(0, 5).toString() !== '%PDF-') { flash(res, 'bad', 'الملف يجب أن يكون PDF صالحًا.'); return res.redirect('/admin/requests/' + r.id); }
  fs.mkdirSync(path.join(PRIVATE_DIR, 'quotes'), { recursive: true });
  const stored = crypto.randomBytes(16).toString('hex') + '.pdf';
  fs.writeFileSync(path.join(PRIVATE_DIR, 'quotes', stored), f.buffer);
  if (r.quote_file) fs.rmSync(path.join(PRIVATE_DIR, 'quotes', path.basename(r.quote_file)), { force: true });
  tx(() => {
    run("UPDATE requests SET quote_file=?, quote_name=?, quote_sent_at=datetime('now'), status='quoted', decision=NULL, decision_at=NULL, updated_at=datetime('now') WHERE id=?", stored, f.originalname.slice(0, 120), r.id);
    ev(r.id, req.user.name, 'quote', f.originalname.slice(0, 120));
  });
  audit(req.user, 'quote', 'request', r.id, r.code);
  notify('request.quoted', { id: r.id, code: r.code, name: r.name, phone: r.phone, email: r.email, track_phone_hint: String(r.phone).slice(-9) }, { subject: `أُرسل عرض السعر ${r.code}`, text: `رُفع عرض السعر للطلب ${r.code} (${r.name}).` });
  flash(res, 'ok', 'رُفع العرض وأصبح ظاهرًا للعميل في صفحة التتبع. أبلغه برقم الطلب.');
  res.redirect('/admin/requests/' + r.id);
});
requestsRouter.get('/:id(\\d+)/quote', (req, res) => {
  const r = one('SELECT * FROM requests WHERE id=?', req.params.id);
  const f = r?.quote_file && path.join(PRIVATE_DIR, 'quotes', path.basename(r.quote_file));
  if (!f || !fs.existsSync(f)) return res.status(404).send('غير موجود');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="quotation-${r.code}.pdf"`);
  fs.createReadStream(f).pipe(res);
});
requestsRouter.get('/:id(\\d+)/file/:n(\\d+)', (req, res) => {
  const r = one('SELECT * FROM requests WHERE id=?', req.params.id);
  const file = r && J(r.files, [])[Number(req.params.n)];
  const f = file && path.join(PRIVATE_DIR, 'uploads', path.basename(file.stored));
  if (!f || !fs.existsSync(f)) return res.status(404).send('غير موجود');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  fs.createReadStream(f).pipe(res);
});
requestsRouter.post('/:id(\\d+)/delete', (req, res) => {
  if (!['owner', 'admin'].includes(req.user.role)) return res.status(403).send('غير مصرّح');
  const r = one('SELECT * FROM requests WHERE id=?', req.params.id);
  if (r) {
    for (const f of J(r.files, [])) fs.rmSync(path.join(PRIVATE_DIR, 'uploads', path.basename(f.stored)), { force: true });
    if (r.quote_file) fs.rmSync(path.join(PRIVATE_DIR, 'quotes', path.basename(r.quote_file)), { force: true });
    run('DELETE FROM requests WHERE id=?', r.id);
    audit(req.user, 'delete', 'request', r.id, r.code);
    flash(res, 'ok', 'حُذف الطلب.');
  }
  res.redirect('/admin/requests');
});
