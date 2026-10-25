import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { html, raw } from '../html.js';
import { one, all, run, tx, J, tr, hasLang, PRIVATE_DIR, audit } from '../db.js';
import { rateLimit } from '../auth.js';
import { notify } from '../notify.js';
import { resolveSeo } from '../seo.js';
import { renderBlock, layout, makeCtx, UI, STATUS, fieldErr } from './render.js';
import { img } from '../media.js';

const RESERVED = new Set(['admin', 'media', 'en', 'api', 'track', 'request', 'products', 'contact-send', 'sitemap.xml', 'robots.txt', 'css', 'js', 'fonts', 'brand', 'healthz']);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 3, fields: 40, fieldSize: 20000 } });
const MAGIC = {
  '.pdf': (b) => b.subarray(0, 5).toString() === '%PDF-',
  '.jpg': (b) => b[0] === 0xff && b[1] === 0xd8, '.jpeg': (b) => b[0] === 0xff && b[1] === 0xd8,
  '.png': (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  '.xlsx': (b) => b[0] === 0x50 && b[1] === 0x4b, '.docx': (b) => b[0] === 0x50 && b[1] === 0x4b,
  '.xls': (b) => b[0] === 0xd0 && b[1] === 0xcf, '.doc': (b) => b[0] === 0xd0 && b[1] === 0xcf,
};

export const toLatinDigits = (s) => String(s ?? '').replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0);
export const phoneDigits = (s) => toLatinDigits(s).replace(/\D/g, '');
export const phoneKey = (s) => phoneDigits(s).slice(-9);
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode() {
  for (;;) {
    let c = 'R-'; const b = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) c += ALPHA[b[i] % ALPHA.length];
    if (!one('SELECT 1 x FROM requests WHERE code=?', c)) return c;
  }
}
const clean = (s, n = 400) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);

// Same-origin check for public POSTs (cookies are SameSite=Lax, this blocks cross-site form posts)
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch { return false; }
}

export function loadPage(slug) {
  const p = one('SELECT * FROM pages WHERE slug=? AND published=1', slug);
  if (!p) return null;
  return { ...p, title: J(p.title), seo: J(p.seo), blocks: J(p.blocks, []), nav_label: J(p.nav_label) };
}

function sendPage(req, res, lang, slug, x = {}) {
  const page = loadPage(slug);
  if (!page) return notFound(req, res, lang);
  const c = makeCtx(req, lang);
  const pth = slug === 'home' ? '/' : '/' + slug;
  const seo = resolveSeo(c, page);
  const xx = { ...x, path: pth, query: req.query, crumbs: slug !== 'home' };
  const body = html`${page.blocks.map((b, i) => renderBlock(c, b, { ...xx, first: i === 0 }))}`;
  res.status(x.status || 200).type('html').send(layout(c, { page, seo, body, path: pth }).toString());
}

export function notFound(req, res, lang = 'ar') {
  const c = makeCtx(req, lang);
  const body = html`<section class="sec notfound"><div class="wrap"><div class="big" aria-hidden="true">404</div><h1>${c.ui.notFound}</h1><p class="lede">${c.ui.notFoundText}</p>
    <a class="btn btn--ink" href="${c.L('/')}">${c.ui.toHome}</a></div></section>`;
  const seo = { title: `${c.ui.notFound} | ${c.t(c.S.brand?.name)}`, desc: c.ui.notFoundText };
  res.status(404).type('html').send(layout(c, { page: null, seo, body, path: req.path, noindex: true, altPath: null }).toString());
}

function pageShell(c, title, inner, path) {
  const body = html`<section class="phead on-ink no-img"><div class="wrap phead__in"><div><nav class="crumbs"><a href="${c.L('/')}">${c.ui.home}</a><span aria-hidden="true">/</span><span>${title}</span></nav><h1>${title}</h1></div></div></section>
    <section class="sec"><div class="wrap">${inner}</div></section>`;
  return layout(c, { page: null, seo: { title: `${title} | ${c.t(c.S.brand?.name)}`, desc: title }, body, path, noindex: true, altPath: path }).toString();
}

function parseItems(raw0) {
  try {
    const a = JSON.parse(raw0 || '[]');
    if (!Array.isArray(a)) return [];
    return a.slice(0, 50).map((i) => ({ id: Number(i.id) || null, name: clean(i.name, 160), qty: Math.min(100000, Math.max(1, parseInt(i.qty, 10) || 1)), opt: clean(i.opt, 120) })).filter((i) => i.name);
  } catch { return []; }
}

function saveFiles(files = []) {
  const saved = [];
  for (const f of files) {
    const ext = path.extname(f.originalname || '').toLowerCase();
    const ok = MAGIC[ext]?.(f.buffer);
    if (!ok) throw Object.assign(new Error('bad file'), { field: 'files', name: f.originalname });
    const stored = crypto.randomBytes(16).toString('hex') + ext;
    fs.mkdirSync(path.join(PRIVATE_DIR, 'uploads'), { recursive: true });
    fs.writeFileSync(path.join(PRIVATE_DIR, 'uploads', stored), f.buffer);
    saved.push({ stored, name: clean(f.originalname, 120), size: f.size });
  }
  return saved;
}

function createRequest(req, { kind, name, org, phone, email, message, items, extra, files }) {
  const code = newCode();
  const r = run('INSERT INTO requests(code,kind,name,org,phone,email,message,items,extra,files,ip) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    code, kind, name, org, phone, email, message, JSON.stringify(items || []), JSON.stringify(extra || {}), JSON.stringify(files || []), req.ip);
  const id = Number(r.lastInsertRowid);
  run("INSERT INTO request_events(request_id,actor,type,note) VALUES(?,?,?,?)", id, 'customer', 'created', null);
  const label = { quote: 'طلب عرض سعر', catering: 'طلب إعاشة', contact: 'رسالة تواصل' }[kind];
  notify('request.created', { id, code, kind, name, org, phone, email, message, items, extra },
    { subject: `${label} جديد ${code} – ${name}`, text: `${label}\nالرقم: ${code}\nالاسم: ${name}\nالجهة: ${org || '-'}\nالجوال: ${phone}\nالبريد: ${email || '-'}\n\n${message || ''}` });
  return code;
}

export function siteRouter(lang) {
  const r = express.Router();

  r.get('/', (req, res) => sendPage(req, res, lang, 'home'));

  r.get('/products/:slug', (req, res) => {
    const p = one('SELECT * FROM products WHERE slug=? AND published=1', req.params.slug);
    if (!p) return notFound(req, res, lang);
    const c = makeCtx(req, lang);
    const name = J(p.name), summary = J(p.summary), body = J(p.body);
    const cat = p.category_id ? one('SELECT * FROM categories WHERE id=?', p.category_id) : null;
    const opts = J(p.options, []);
    const nm = c.t(name);
    const seo = J(p.seo);
    const desc = (c.t(seo.desc) || c.t(summary) || nm).slice(0, 160);
    const inner = html`<div class="ti"><div>
        <p class="lede">${c.t(summary)}</p>${String(c.t(body)).split(/\n\s*\n/).filter(Boolean).map((t) => html`<p>${t}</p>`)}
        ${opts.length ? html`<h2 style="font-size:1.3rem;margin-top:1.4em">${c.ui.options}</h2><div class="fld"><select id="opt" aria-label="${c.ui.options}">${opts.map((o) => html`<option>${c.t(o)}</option>`)}</select></div>` : ''}
        <p style="margin-top:24px"><button type="button" class="btn btn--ink" data-add data-id="${p.id}" data-name="${nm}" ${raw(opts.length ? 'data-opt-from="#opt"' : '')}>${c.ui.add}</button>
        <a class="btn btn--line" style="color:var(--ink);margin-inline-start:8px" href="${c.L('/request-quote')}">${c.ui.quote}</a></p></div>
      ${p.image_id ? html`<div class="ti__pic">${img(p.image_id, { lang, alt: nm, eager: true, sizes: '(min-width:860px) 46vw, 100vw' })}</div>` : ''}</div>`;
    const page = { slug: 'product', title: name, seo: { og: p.image_id }, blocks: [] };
    const body2 = html`<section class="phead on-ink no-img"><div class="wrap phead__in"><div><nav class="crumbs"><a href="${c.L('/')}">${c.ui.home}</a><span aria-hidden="true">/</span>${cat ? html`<span>${c.t(J(cat.name))}</span><span aria-hidden="true">/</span>` : ''}<span>${nm}</span></nav><h1>${nm}</h1></div></div></section><section class="sec"><div class="wrap">${inner}</div></section>`;
    const ld = { '@context': 'https://schema.org', '@type': 'Product', name: nm, description: desc, ...(p.sku ? { sku: p.sku } : {}), brand: { '@type': 'Brand', name: c.t(c.S.brand?.name) } };
    res.type('html').send(layout(c, { page, seo: { title: `${c.t(seo.title) || nm} | ${c.t(c.S.brand?.name)}`, desc, og: p.image_id, h1: nm, enOk: hasLang(name, 'en') }, body: body2, path: '/products/' + p.slug, extraLd: [ld] }).toString());
  });

  // ── track a request
  r.get('/track', (req, res) => {
    const c = makeCtx(req, lang);
    res.type('html').send(pageShell(c, c.ui.track, trackForm(c, {}), '/track'));
  });
  r.post('/track', express.urlencoded({ extended: false, limit: '10kb' }), (req, res) => {
    const c = makeCtx(req, lang);
    if (!sameOrigin(req)) return res.status(403).send('Forbidden');
    if (rateLimit('track:' + req.ip, 12, 10 * 60 * 1000)) return res.status(429).type('html').send(pageShell(c, c.ui.track, html`<div class="notice bad">${lang === 'ar' ? 'محاولات كثيرة. حاول بعد قليل.' : 'Too many attempts. Try again shortly.'}</div>`, '/track'));
    const code = clean(req.body.code, 20).toUpperCase(), phone = req.body.phone;
    const rq = one('SELECT * FROM requests WHERE code=?', code);
    if (!rq || phoneKey(rq.phone) !== phoneKey(phone) || phoneKey(phone).length < 9)
      return res.status(404).type('html').send(pageShell(c, c.ui.track, trackForm(c, { code, err: lang === 'ar' ? 'لم نجد طلبًا بهذه البيانات. تأكد من الرقم والجوال.' : 'No request matches these details. Check the number and mobile.' }), '/track'));
    res.type('html').send(pageShell(c, c.ui.track, trackStatus(c, rq, phone), '/track'));
  });
  r.post('/track/decision', express.urlencoded({ extended: false, limit: '10kb' }), (req, res) => {
    const c = makeCtx(req, lang);
    if (!sameOrigin(req)) return res.status(403).send('Forbidden');
    if (rateLimit('trackd:' + req.ip, 12, 10 * 60 * 1000)) return res.status(429).send('Too many attempts');
    const rq = one('SELECT * FROM requests WHERE code=?', clean(req.body.code, 20).toUpperCase());
    if (!rq || phoneKey(rq.phone) !== phoneKey(req.body.phone)) return res.status(404).send('Not found');
    const d = req.body.decision;
    if (rq.status === 'quoted' && (d === 'accept' || d === 'reject')) {
      const st = d === 'accept' ? 'accepted' : 'rejected';
      tx(() => {
        run("UPDATE requests SET status=?, decision=?, decision_at=datetime('now'), updated_at=datetime('now') WHERE id=?", st, d, rq.id);
        run('INSERT INTO request_events(request_id,actor,type,note) VALUES(?,?,?,?)', rq.id, 'customer', st, null);
      });
      notify('request.decision', { id: rq.id, code: rq.code, decision: st, name: rq.name }, { subject: `${st === 'accepted' ? 'قُبل' : 'رُفض'} عرض السعر ${rq.code} – ${rq.name}` });
    }
    const fresh = one('SELECT * FROM requests WHERE id=?', rq.id);
    res.type('html').send(pageShell(c, c.ui.track, trackStatus(c, fresh, req.body.phone), '/track'));
  });
  r.get('/track/quote', (req, res) => {
    if (rateLimit('trackq:' + req.ip, 20, 10 * 60 * 1000)) return res.status(429).send('Too many attempts');
    const rq = one('SELECT * FROM requests WHERE code=?', clean(req.query.code, 20).toUpperCase());
    if (!rq || phoneKey(rq.phone) !== phoneKey(req.query.phone) || !rq.quote_file || rq.status === 'new' || rq.status === 'pricing') return res.status(404).send('Not found');
    const f = path.join(PRIVATE_DIR, 'quotes', path.basename(rq.quote_file));
    if (!fs.existsSync(f)) return res.status(404).send('Not found');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="quotation-${rq.code}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    fs.createReadStream(f).pipe(res);
  });

  // ── submit forms
  const submit = (kindFixed) => [upload.array('files', 3), (req, res) => {
    const c = makeCtx(req, lang);
    const b = req.body || {};
    const back = (errs, formError, status = 422) => {
      const slug = kindFixed === 'contact' ? 'contact' : 'request-quote';
      return sendPage(req, res, lang, slug, { vals: b, errs, formError, status });
    };
    if (!sameOrigin(req)) return res.status(403).send('Forbidden');
    if (b.website) return res.redirect(c.L('/')); // honeypot
    if (Date.now() - Number(b.ts || 0) < 2500) return back({}, lang === 'ar' ? 'أُرسل النموذج بسرعة كبيرة. حاول مرة أخرى.' : 'The form was sent too quickly. Please try again.');
    if (rateLimit('form:' + req.ip, 6, 60 * 60 * 1000)) return res.status(429).type('html').send(pageShell(c, c.ui.send, html`<div class="notice bad">${lang === 'ar' ? 'وصلتنا طلبات كثيرة من جهازك. حاول بعد ساعة أو اتصل بنا.' : 'Too many requests from your device. Try again in an hour or call us.'}</div>`, '/request-quote'));
    const kind = kindFixed || (['quote', 'catering'].includes(b.kind) ? b.kind : 'quote');
    const errs = {}, req_ = c.ui.required;
    const name = clean(b.name, 120), phone = clean(toLatinDigits(b.phone), 30), email = clean(b.email, 160), message = clean(b.message, 4000);
    if (!name) errs.name = req_;
    if (phoneDigits(phone).length < 9 || phoneDigits(phone).length > 15) errs.phone = lang === 'ar' ? 'اكتب رقم جوال صحيحًا (9 أرقام على الأقل).' : 'Enter a valid mobile number (at least 9 digits).';
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errs.email = lang === 'ar' ? 'البريد الإلكتروني غير صحيح.' : 'The email address is not valid.';
    if (kind === 'contact' && !message) errs.message = req_;
    const items = kind === 'contact' ? [] : parseItems(b.items);
    if (kind !== 'contact' && !message && !items.length) errs.message = lang === 'ar' ? 'اكتب تفاصيل الطلب أو أضف منتجات.' : 'Describe your request or add products.';
    const extra = {};
    if (kind === 'catering') {
      extra.people = Math.min(10000000, Math.max(0, parseInt(toLatinDigits(b.people), 10) || 0)) || null;
      extra.days = Math.min(3650, Math.max(0, parseInt(toLatinDigits(b.days), 10) || 0)) || null;
      extra.place = clean(b.place, 200); extra.start = /^\d{4}-\d{2}-\d{2}$/.test(b.start || '') ? b.start : '';
    }
    if (Object.keys(errs).length) return back(errs, lang === 'ar' ? 'راجع الحقول المحددة أدناه.' : 'Check the highlighted fields below.');
    let files = [];
    try { files = saveFiles(req.files); } catch (e) { return back({ files: lang === 'ar' ? `الملف «${e.name}» غير مدعوم أو تالف.` : `The file "${e.name}" is not supported or is damaged.` }, lang === 'ar' ? 'تعذّر رفع الملف.' : 'The file could not be uploaded.'); }
    const code = createRequest(req, { kind, name, org: clean(b.org, 160), phone, email, message, items, extra, files });
    const body = html`<div class="notice"><h2 style="margin:0 0 .3em;font-size:1.6rem">${c.ui.thanks}</h2>
      <p>${c.ui.thanksText}: <strong style="font:600 1.6rem var(--f-num);letter-spacing:.08em" dir="ltr">${code}</strong></p><p>${c.ui.thanksNext}</p>
      <p><a class="btn btn--ink" href="${c.L('/track')}">${c.ui.track}</a> <a class="btn btn--line" style="color:var(--ink)" href="${c.L('/')}">${c.ui.toHome}</a></p></div>
      <script nonce="${res.locals.nonce}">try{localStorage.removeItem('sumova_cart')}catch(e){}</script>`;
    res.type('html').send(pageShell(c, c.ui.thanks, body, '/request-quote'));
  }];
  r.post('/request', ...submit(null));
  r.post('/contact-send', ...submit('contact'));

  // ── generic pages (must stay last)
  r.get('/:slug', (req, res, next) => {
    const s = req.params.slug;
    if (RESERVED.has(s)) return next();
    sendPage(req, res, lang, s);
  });
  return r;
}

function trackForm(c, { code = '', err = '' }) {
  return html`<form class="form" method="post" action="${c.L('/track')}" style="max-width:520px">
    ${err ? html`<div class="notice bad" role="alert">${err}</div>` : ''}
    <div class="fld"><label for="tc">${c.ui.code}</label><input id="tc" name="code" value="${code}" required dir="ltr" placeholder="R-XXXXXX" autocomplete="off"></div>
    <div class="fld"><label for="tp">${c.ui.mobile}</label><input id="tp" name="phone" type="tel" inputmode="tel" required dir="ltr"></div>
    <div><button class="btn btn--ink" type="submit">${c.ui.trackBtn}</button></div></form>`;
}
function trackStatus(c, rq, phone) {
  const st = STATUS[rq.status]?.[c.lang] || rq.status;
  const hasQuote = rq.quote_file && ['quoted', 'accepted', 'rejected', 'confirmed'].includes(rq.status);
  const items = J(rq.items, []);
  return html`<div class="prose" style="max-width:640px"><p>${c.ui.code}: <strong dir="ltr" style="font:600 1.4rem var(--f-num)">${rq.code}</strong></p>
    <p>${c.ui.status}: <span class="status-pill">${st}</span></p>
    ${items.length ? html`<ul>${items.map((i) => html`<li>${i.name}${i.opt ? ' – ' + i.opt : ''} × ${i.qty}</li>`)}</ul>` : ''}
    ${hasQuote ? html`<p><a class="btn btn--gold" href="${c.L('/track/quote')}?code=${rq.code}&phone=${encodeURIComponent(phone)}">${c.ui.downloadQuote}</a></p>` : ''}
    ${rq.status === 'quoted' ? html`<form method="post" action="${c.L('/track/decision')}" style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px">
      <input type="hidden" name="code" value="${rq.code}"><input type="hidden" name="phone" value="${phone}">
      <button class="btn btn--ink" name="decision" value="accept">${c.ui.accept}</button><button class="btn btn--line" style="color:var(--ink)" name="decision" value="reject">${c.ui.reject}</button></form>` : ''}</div>`;
}
