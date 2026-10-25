import express from 'express';
import multer from 'multer';
import { html, raw } from '../html.js';
import { one, all, run, tx, J, tr, audit } from '../db.js';
import { requirePerm, guardAfterUpload } from '../auth.js';
import { getMedia, mediaUrl, addMedia, replaceMedia, deleteMedia, mediaUsage, dropMediaCache } from '../media.js';
import { BLOCKS } from '../blocks.js';
import { shell, flash, csrf, fld, area, i18n, readI18n, check, select, fmtDate, pageHead, slugify } from './ui.js';
import { blockCard, blockTemplates, readBlocks } from './blockform.js';

export const contentRouter = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 10, fields: 30 } });
const RESERVED = new Set(['admin', 'media', 'en', 'api', 'track', 'request', 'products', 'contact-send', 'sitemap.xml', 'robots.txt', 'css', 'js', 'fonts', 'brand', 'healthz']);
const LOCKED = new Set(['home', 'request-quote', 'contact']); // other code depends on these slugs
const page = (r) => ({ ...r, title: J(r.title), seo: J(r.seo), blocks: J(r.blocks, []), nav_label: J(r.nav_label) });

// ═════════════════════ PAGES
contentRouter.get('/pages', requirePerm('pages'), (req, res) => {
  const rows = all('SELECT * FROM pages ORDER BY sort,id').map(page);
  shell(req, res, { title: 'الصفحات', active: '/admin/pages', body: html`${pageHead('الصفحات')}
  <table class="tbl"><thead><tr><th>الصفحة</th><th>الرابط</th><th>الحالة</th><th>في القائمة</th><th>آخر تعديل</th><th></th></tr></thead><tbody>
  ${rows.map((p) => html`<tr><td><a href="/admin/pages/${p.id}"><b>${tr(p.title) || p.slug}</b></a></td><td dir="ltr">${p.slug === 'home' ? '/' : '/' + p.slug}</td>
    <td><span class="pill ${p.published ? 's-accepted' : 's-closed'}">${p.published ? 'منشورة' : 'مسودة'}</span></td><td>${p.show_in_nav ? 'نعم' : '—'}</td><td>${fmtDate(p.updated_at)}</td>
    <td><a href="/admin/pages/${p.id}">تعديل</a> · <a href="${p.slug === 'home' ? '/' : '/' + p.slug}" target="_blank" rel="noopener">عرض ↗</a></td></tr>`)}</tbody></table>
  <section class="card narrow"><div class="card__h"><h2>صفحة جديدة</h2></div><form method="post" action="/admin/pages" class="stack">${csrf(req)}
    ${fld('title_ar', 'عنوان الصفحة', '', { req: true })}${fld('slug', 'الرابط', '', { dir: 'ltr', hint: 'حروف إنجليزية صغيرة وأرقام وشرطات. مثال: our-clients', attrs: 'pattern="[a-z0-9\\-]+"' })}
    <button class="btn btn--ink">إنشاء</button></form></section>` });
});

contentRouter.post('/pages', requirePerm('pages'), (req, res) => {
  const title = String(req.body.title_ar || '').trim().slice(0, 120);
  let slug = slugify(req.body.slug || '').replace(/[^a-z0-9-]/g, '');
  if (!title) { flash(res, 'bad', 'اكتب عنوان الصفحة.'); return res.redirect('/admin/pages'); }
  if (!slug) slug = 'page-' + Date.now().toString(36);
  if (RESERVED.has(slug) || one('SELECT 1 x FROM pages WHERE slug=?', slug)) { flash(res, 'bad', 'هذا الرابط مستخدم. اختر رابطًا آخر.'); return res.redirect('/admin/pages'); }
  const blocks = [{ id: Math.random().toString(36).slice(2, 9), type: 'page_head', data: { title: { ar: title, en: '' }, lede: { ar: '', en: '' }, media: null } }];
  const r = run("INSERT INTO pages(slug,title,blocks,published,sort) VALUES(?,?,?,0,(SELECT COALESCE(MAX(sort),0)+10 FROM pages))", slug, JSON.stringify({ ar: title, en: '' }), JSON.stringify(blocks));
  audit(req.user, 'create', 'page', r.lastInsertRowid, slug);
  flash(res, 'ok', 'أُنشئت الصفحة كمسودة. أضف الأقسام ثم انشرها.');
  res.redirect('/admin/pages/' + r.lastInsertRowid);
});

contentRouter.get('/pages/:id(\\d+)', requirePerm('pages'), (req, res) => {
  const row = one('SELECT * FROM pages WHERE id=?', req.params.id);
  if (!row) return res.redirect('/admin/pages');
  const p = page(row), locked = LOCKED.has(p.slug), seo = p.seo || {};
  const og = getMedia(Number(seo.og));
  const url = p.slug === 'home' ? '/' : '/' + p.slug;
  shell(req, res, { title: tr(p.title) || p.slug, active: '/admin/pages', wide: true, body: html`
  <form method="post" action="/admin/pages/${p.id}" id="pageform" class="stack" data-pageform>${csrf(req)}
  <div class="phd"><h1>${tr(p.title) || p.slug}</h1><div class="acts"><a class="btn-s" href="${url}" target="_blank" rel="noopener">عرض الصفحة ↗</a><button class="btn btn--ink">حفظ التغييرات</button></div></div>
  <div class="editor">
   <div class="editor__main">
    <section class="card"><div class="card__h"><h2>أقسام الصفحة</h2></div>
      <ol class="blocks" data-blocks>${p.blocks.map((b, i) => blockCard(b.type, b.data, i, b.id))}</ol>
      <div class="addblock"><label for="newblock">إضافة قسم</label><select id="newblock" data-newtype>${Object.entries(BLOCKS).map(([k, v]) => html`<option value="${k}">${v.label}</option>`)}</select><button type="button" class="btn-s" data-addblock>+ إضافة</button></div>
    </section>
   </div>
   <aside class="editor__side">
    <section class="card"><div class="card__h"><h2>الصفحة</h2></div>
      ${i18n('title', 'اسم الصفحة', p.title)}
      ${locked ? html`<div class="f"><span class="lbl">الرابط</span><b dir="ltr">${url}</b><small>رابط أساسي لا يتغير.</small></div>` : fld('slug', 'الرابط', p.slug, { dir: 'ltr', attrs: 'pattern="[a-z0-9\\-]+" required', hint: 'عند تغييره يُنشأ تحويل 301 من الرابط القديم تلقائيًا.' })}
      ${check('published', 'منشورة', p.published)}
      ${p.slug === 'home' ? '' : html`${check('show_in_nav', 'تظهر في القائمة العلوية', p.show_in_nav)}${i18n('nav_label', 'اسم القائمة (اختياري)', p.nav_label)}${fld('sort', 'الترتيب (الأصغر أولًا)', p.sort, { type: 'number', attrs: 'step="10"' })}`}
    </section>
    <section class="card" id="seo"><div class="card__h"><h2>محركات البحث</h2></div>
      ${i18n('seo_title', 'عنوان البحث', seo.title, { counter: '65', hint: 'إن تُرك فارغًا يُستخدم اسم الصفحة. المثالي أقل من 65 حرفًا.' })}
      ${i18n('seo_desc', 'الوصف', seo.desc, { area: true, rows: 3, counter: '160', hint: 'جملة أو جملتان تظهران تحت العنوان في Google. بين 70 و160 حرفًا.' })}
      <div class="f mediafield" data-media><span class="lbl">صورة المشاركة (واتساب وX)</span><div class="mediabox"><div class="thumb">${og ? html`<img src="${raw(mediaUrl(og.id, 480))}" alt="" width="120" height="80">` : html`<span class="empty">تلقائي</span>`}</div>
        <div class="mbtns"><input type="hidden" name="seo_og" value="${og ? og.id : ''}"><button type="button" class="btn-s" data-pick>اختيار</button><button type="button" class="linkbtn" data-clear ${raw(og ? '' : 'hidden')}>إزالة</button></div></div></div>
      ${check('seo_noindex', 'إخفاء الصفحة من محركات البحث (noindex)', seo.noindex)}
    </section>
    ${locked ? '' : html`<section class="card"><div class="card__h"><h2>حذف</h2></div><button class="btn-s bad" formaction="/admin/pages/${p.id}/delete" formnovalidate data-confirm="حذف الصفحة نهائيًا؟">حذف الصفحة</button></section>`}
   </aside></div></form>
  ${blockTemplates()}` });
});

contentRouter.post('/pages/:id(\\d+)', requirePerm('pages'), (req, res) => {
  const row = one('SELECT * FROM pages WHERE id=?', req.params.id);
  if (!row) return res.redirect('/admin/pages');
  const b = req.body, locked = LOCKED.has(row.slug);
  const title = readI18n(b, 'title', 120);
  if (!title.ar) { flash(res, 'bad', 'اسم الصفحة بالعربية مطلوب.'); return res.redirect('/admin/pages/' + row.id); }
  let slug = row.slug;
  if (!locked) {
    slug = slugify(b.slug || '').replace(/[^a-z0-9-]/g, '');
    if (!slug || RESERVED.has(slug) || (slug !== row.slug && one('SELECT 1 x FROM pages WHERE slug=?', slug))) { flash(res, 'bad', 'الرابط غير صالح أو مستخدم.'); return res.redirect('/admin/pages/' + row.id); }
  }
  const seo = { title: readI18n(b, 'seo_title', 120), desc: readI18n(b, 'seo_desc', 320), og: parseInt(b.seo_og, 10) || null, noindex: b.seo_noindex === '1' };
  const blocks = readBlocks(b);
  const nav = readI18n(b, 'nav_label', 60);
  tx(() => {
    run("UPDATE pages SET slug=?, title=?, seo=?, blocks=?, published=?, show_in_nav=?, nav_label=?, sort=?, updated_at=datetime('now') WHERE id=?",
      slug, JSON.stringify(title), JSON.stringify(seo), JSON.stringify(blocks), b.published === '1' ? 1 : 0, row.slug === 'home' ? 0 : (b.show_in_nav === '1' ? 1 : 0), JSON.stringify(nav),
      row.slug === 'home' ? row.sort : parseInt(b.sort, 10) || 0, row.id);
    if (slug !== row.slug) {
      run('DELETE FROM redirects WHERE from_path=?', '/' + slug);
      run('INSERT INTO redirects(from_path,to_path,code) VALUES(?,?,301) ON CONFLICT(from_path) DO UPDATE SET to_path=excluded.to_path', '/' + row.slug, '/' + slug);
    }
  });
  audit(req.user, 'update', 'page', row.id, `${slug} – ${blocks.length} قسم`);
  flash(res, 'ok', 'تم حفظ الصفحة. التغييرات ظاهرة الآن على الموقع.');
  res.redirect('/admin/pages/' + row.id);
});
contentRouter.post('/pages/:id(\\d+)/delete', requirePerm('pages'), (req, res) => {
  const row = one('SELECT * FROM pages WHERE id=?', req.params.id);
  if (row && !LOCKED.has(row.slug)) { run('DELETE FROM pages WHERE id=?', row.id); audit(req.user, 'delete', 'page', row.id, row.slug); flash(res, 'ok', 'حُذفت الصفحة.'); }
  res.redirect('/admin/pages');
});

// ═════════════════════ MEDIA
const mediaCard = (m) => html`<a class="mcard" href="/admin/media/${m.id}"><img src="${raw(mediaUrl(m.id, 480))}" alt="" width="240" height="160" loading="lazy"><span>${tr(J(m.alt)) || m.orig_name || 'صورة ' + m.id}</span>${tr(J(m.alt)) ? '' : html`<i class="warnchip">بلا وصف</i>`}</a>`;

contentRouter.get('/media', requirePerm('media'), (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  const rows = q ? all("SELECT * FROM media WHERE orig_name LIKE ? OR alt LIKE ? ORDER BY id DESC", `%${q}%`, `%${q}%`) : all('SELECT * FROM media ORDER BY id DESC');
  shell(req, res, { title: 'الصور', active: '/admin/media', body: html`${pageHead('الصور')}
  <form class="card inline" method="post" action="/admin/media/upload" enctype="multipart/form-data"><input type="file" name="files" accept="image/jpeg,image/png,image/webp" multiple required aria-label="اختر الصور"><input type="hidden" name="_csrf" value="${req.csrf}"><button class="btn btn--ink">رفع</button><small>JPG أو PNG أو WebP حتى 15 ميجابايت. تُحوَّل تلقائيًا إلى أحجام خفيفة.</small></form>
  <form class="inline" method="get"><input name="q" value="${q}" placeholder="ابحث باسم الملف أو الوصف" aria-label="بحث"><button class="btn-s">بحث</button></form>
  ${rows.length ? html`<div class="mgrid">${rows.map(mediaCard)}</div>` : html`<p class="empty">لا توجد صور.</p>`}` });
});
contentRouter.get('/media/picker.json', requirePerm('media'), (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  const rows = q ? all("SELECT * FROM media WHERE orig_name LIKE ? OR alt LIKE ? ORDER BY id DESC LIMIT 120", `%${q}%`, `%${q}%`) : all('SELECT * FROM media ORDER BY id DESC LIMIT 120');
  res.json(rows.map((m) => ({ id: m.id, thumb: mediaUrl(m.id, 480), name: tr(J(m.alt)) || m.orig_name || `صورة ${m.id}` })));
});
contentRouter.post('/media/upload', requirePerm('media'), upload.array('files', 10), guardAfterUpload, async (req, res) => {
  const done = [], failed = [];
  for (const f of req.files || []) {
    try { done.push(await addMedia(f.buffer, f.originalname.slice(0, 120))); audit(req.user, 'create', 'media', done.at(-1), f.originalname.slice(0, 80)); }
    catch (e) { failed.push(f.originalname + ': ' + e.message); }
  }
  if (req.query.json || req.headers.accept?.includes('application/json')) return res.status(failed.length && !done.length ? 422 : 200).json({ ids: done, failed });
  flash(res, failed.length ? 'bad' : 'ok', failed.length ? `تعذّر رفع: ${failed.join(' | ')}` : `رُفعت ${done.length} صورة.`);
  res.redirect(done.length === 1 ? '/admin/media/' + done[0] : '/admin/media');
});
contentRouter.get('/media/:id(\\d+)', requirePerm('media'), (req, res) => {
  const m = getMedia(Number(req.params.id));
  if (!m) return res.redirect('/admin/media');
  const use = mediaUsage(m.id), alt = J(m.alt);
  const link = (u) => (u.type === 'page' ? `/admin/pages/${u.id}` : u.type === 'product' ? `/admin/products/${u.id}` : `/admin/products/cat/${u.id}`);
  shell(req, res, { title: 'الصورة', active: '/admin/media', body: html`${pageHead(m.orig_name || 'صورة ' + m.id)}
  <div class="editor"><div class="editor__main"><section class="card"><img class="bigprev" src="${raw(mediaUrl(m.id, 1600))}" alt="${tr(alt)}" width="${m.width}" height="${m.height}"><p class="hint" dir="ltr">${m.width}×${m.height}px · ${(m.bytes / 1024).toFixed(0)} KB</p></section></div>
  <aside class="editor__side">
   <form method="post" action="/admin/media/${m.id}" class="card stack">${csrf(req)}<div class="card__h"><h2>النص البديل</h2></div>
    ${i18n('alt', 'وصف الصورة', alt, { hint: 'يقرؤه قارئ الشاشة ويستخدمه Google. صف ما في الصورة في جملة قصيرة.' })}<button class="btn btn--ink">حفظ الوصف</button></form>
   <form method="post" action="/admin/media/${m.id}/replace" enctype="multipart/form-data" class="card stack"><div class="card__h"><h2>استبدال الصورة</h2></div>
    <p class="hint">تحل الصورة الجديدة محل القديمة في كل مكان تُستخدم فيه.</p><input type="hidden" name="_csrf" value="${req.csrf}"><input type="file" name="file" accept="image/jpeg,image/png,image/webp" required aria-label="الصورة الجديدة"><button class="btn-s">استبدال</button></form>
   <section class="card"><div class="card__h"><h2>أين تُستخدم</h2></div>${use.length ? html`<ul class="plain">${use.map((u) => html`<li><a href="${link(u)}">${u.label}</a> <small>${{ page: 'صفحة', product: 'منتج', category: 'تصنيف' }[u.type]}</small></li>`)}</ul>` : html`<p class="empty">غير مستخدمة.</p>`}</section>
   <section class="card"><div class="card__h"><h2>حذف</h2></div>${use.length ? html`<p class="hint">لا يمكن حذف صورة مستخدمة. استبدلها أو أزلها من أماكن استخدامها أولًا.</p>` : html`<form method="post" action="/admin/media/${m.id}/delete">${csrf(req)}<button class="btn-s bad" data-confirm="حذف الصورة نهائيًا؟">حذف</button></form>`}</section>
  </aside></div>` });
});
contentRouter.post('/media/:id(\\d+)', requirePerm('media'), (req, res) => {
  const m = getMedia(Number(req.params.id));
  if (!m) return res.redirect('/admin/media');
  run("UPDATE media SET alt=?, updated_at=datetime('now') WHERE id=?", JSON.stringify(readI18n(req.body, 'alt', 200)), m.id);
  dropMediaCache(m.id);
  audit(req.user, 'update', 'media', m.id, 'النص البديل');
  flash(res, 'ok', 'تم حفظ الوصف.');
  res.redirect('/admin/media/' + m.id);
});
contentRouter.post('/media/:id(\\d+)/replace', requirePerm('media'), upload.single('file'), guardAfterUpload, async (req, res) => {
  const id = Number(req.params.id);
  try {
    if (!req.file) throw new Error('اختر ملفًا.');
    await replaceMedia(id, req.file.buffer, req.file.originalname.slice(0, 120));
    audit(req.user, 'replace', 'media', id, req.file.originalname.slice(0, 80));
    flash(res, 'ok', 'استُبدلت الصورة في كل أماكنها.');
  } catch (e) { flash(res, 'bad', e.message); }
  res.redirect('/admin/media/' + id);
});
contentRouter.post('/media/:id(\\d+)/delete', requirePerm('media'), (req, res) => {
  const id = Number(req.params.id);
  if (mediaUsage(id).length) flash(res, 'bad', 'الصورة مستخدمة ولا يمكن حذفها.');
  else { deleteMedia(id); audit(req.user, 'delete', 'media', id); flash(res, 'ok', 'حُذفت الصورة.'); }
  res.redirect('/admin/media');
});

// ═════════════════════ PRODUCTS & CATEGORIES
const catSelect = (v) => select('category_id', 'التصنيف', [['', 'بدون تصنيف'], ...all('SELECT id,name FROM categories ORDER BY sort,id').map((c) => [c.id, tr(J(c.name))])], v ?? '');
const mediaPick = (name, label, id) => { const m = getMedia(Number(id)); return html`<div class="f mediafield" data-media><span class="lbl">${label}</span><div class="mediabox"><div class="thumb">${m ? html`<img src="${raw(mediaUrl(m.id, 480))}" alt="" width="120" height="80">` : html`<span class="empty">بدون صورة</span>`}</div>
  <div class="mbtns"><input type="hidden" name="${name}" value="${m ? m.id : ''}"><button type="button" class="btn-s" data-pick>اختيار</button><button type="button" class="linkbtn" data-clear ${raw(m ? '' : 'hidden')}>إزالة</button></div></div></div>`; };

contentRouter.get('/products', requirePerm('products'), (req, res) => {
  const prods = all('SELECT p.*, c.name cname FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.sort,p.id');
  const cats = all('SELECT * FROM categories ORDER BY sort,id');
  shell(req, res, { title: 'المنتجات', active: '/admin/products', body: html`${pageHead('المنتجات', html`<a class="btn btn--ink" href="/admin/products/new">+ منتج جديد</a>`)}
  <p class="hint">المنتجات تظهر في «كتالوج المنتجات» داخل صفحاتك. الزائر يضيفها إلى طلب عرض سعر، ولا يوجد شراء مباشر.</p>
  ${prods.length ? html`<table class="tbl"><thead><tr><th></th><th>المنتج</th><th>التصنيف</th><th>الحالة</th><th></th></tr></thead><tbody>${prods.map((p) => html`<tr><td class="tn">${p.image_id ? html`<img src="${raw(mediaUrl(p.image_id, 480))}" alt="" width="64" height="44">` : ''}</td><td><a href="/admin/products/${p.id}"><b>${tr(J(p.name))}</b></a></td><td>${p.cname ? tr(J(p.cname)) : '—'}</td><td><span class="pill ${p.published ? 's-accepted' : 's-closed'}">${p.published ? 'منشور' : 'مخفي'}</span></td><td><a href="/admin/products/${p.id}">تعديل</a></td></tr>`)}</tbody></table>` : html`<p class="empty">لم تُضف منتجات بعد. أضف أول منتج ليظهر في الكتالوج.</p>`}
  <section class="card"><div class="card__h"><h2>التصنيفات</h2><a href="/admin/products/cat/new">+ تصنيف</a></div>${cats.length ? html`<ul class="plain">${cats.map((c) => html`<li><a href="/admin/products/cat/${c.id}">${tr(J(c.name))}</a> <small>${c.published ? '' : '(مخفي)'}</small></li>`)}</ul>` : html`<p class="empty">لا توجد تصنيفات.</p>`}</section>` });
});

const prodForm = (req, p, isNew) => {
  const o = J(p.options, []);
  return html`<form method="post" action="/admin/products/${isNew ? 'new' : p.id}" class="editor stack">${csrf(req)}
  <div class="editor__main"><section class="card">
    ${i18n('name', 'اسم المنتج', J(p.name), { })}${i18n('summary', 'وصف مختصر (يظهر في الكتالوج)', J(p.summary), { area: true, rows: 2 })}${i18n('body', 'تفاصيل المنتج', J(p.body), { area: true, rows: 7 })}
    <div class="f i18n"><span class="lbl">الخيارات (مثل الأحجام) – خيار في كل سطر</span><div class="pair"><div><label for="opts_ar">عربي</label><textarea id="opts_ar" name="opts_ar" rows="4" dir="rtl">${o.map((x) => x.ar).join('\n')}</textarea></div><div><label for="opts_en">English</label><textarea id="opts_en" name="opts_en" rows="4" dir="ltr">${o.map((x) => x.en).join('\n')}</textarea></div></div></div>
  </section>
  <section class="card" id="seo"><div class="card__h"><h2>محركات البحث</h2></div>${i18n('seo_title', 'عنوان البحث', J(p.seo).title, { counter: '65' })}${i18n('seo_desc', 'الوصف', J(p.seo).desc, { area: true, rows: 3, counter: '160' })}</section></div>
  <aside class="editor__side"><section class="card">
    ${mediaPick('image_id', 'صورة المنتج', p.image_id)}${catSelect(p.category_id)}
    ${fld('slug', 'الرابط', p.slug || '', { dir: 'ltr', attrs: 'pattern="[a-z0-9\\-]*"', hint: 'يُولَّد تلقائيًا إن تُرك فارغًا.' })}${fld('sku', 'رمز المنتج SKU (اختياري)', p.sku || '', { dir: 'ltr' })}
    ${fld('sort', 'الترتيب', p.sort ?? 0, { type: 'number' })}${check('published', 'ظاهر في الموقع', isNew ? true : p.published)}
    <button class="btn btn--ink">${isNew ? 'إضافة المنتج' : 'حفظ'}</button></section>
  ${isNew ? '' : html`<section class="card"><button class="btn-s bad" formaction="/admin/products/${p.id}/delete" formnovalidate data-confirm="حذف المنتج نهائيًا؟">حذف المنتج</button></section>`}</aside></form>`;
};
contentRouter.get('/products/new', requirePerm('products'), (req, res) => shell(req, res, { title: 'منتج جديد', active: '/admin/products', wide: true, body: html`${pageHead('منتج جديد')}${prodForm(req, {}, true)}` }));
contentRouter.get('/products/:id(\\d+)', requirePerm('products'), (req, res) => {
  const p = one('SELECT * FROM products WHERE id=?', req.params.id);
  if (!p) return res.redirect('/admin/products');
  shell(req, res, { title: tr(J(p.name)), active: '/admin/products', wide: true, body: html`${pageHead(tr(J(p.name)), html`<a class="btn-s" href="/products/${p.slug}" target="_blank" rel="noopener">عرض ↗</a>`)}${prodForm(req, p, false)}` });
});
function saveProduct(req, res, id) {
  const b = req.body, name = readI18n(b, 'name', 160);
  if (!name.ar) { flash(res, 'bad', 'اسم المنتج بالعربية مطلوب.'); return res.redirect(id ? '/admin/products/' + id : '/admin/products/new'); }
  let slug = slugify(b.slug || '').replace(/[^a-z0-9-]/g, '') || slugify(name.en || '').replace(/[^a-z0-9-]/g, '') || 'product-' + Date.now().toString(36);
  const clash = one('SELECT id FROM products WHERE slug=?', slug);
  if (clash && clash.id !== id) slug += '-' + Math.random().toString(36).slice(2, 5);
  const ar = String(b.opts_ar || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 30), en = String(b.opts_en || '').split('\n').map((s) => s.trim());
  const options = ar.map((a, i) => ({ ar: a.slice(0, 80), en: (en[i] || '').slice(0, 80) }));
  const seo = { title: readI18n(b, 'seo_title', 120), desc: readI18n(b, 'seo_desc', 320) };
  const vals = [slug, JSON.stringify(name), JSON.stringify(readI18n(b, 'summary', 400)), JSON.stringify(readI18n(b, 'body', 6000)), parseInt(b.image_id, 10) || null, parseInt(b.category_id, 10) || null, JSON.stringify(options), String(b.sku || '').trim().slice(0, 40) || null, JSON.stringify(seo), parseInt(b.sort, 10) || 0, b.published === '1' ? 1 : 0];
  if (id) run("UPDATE products SET slug=?,name=?,summary=?,body=?,image_id=?,category_id=?,options=?,sku=?,seo=?,sort=?,published=?,updated_at=datetime('now') WHERE id=?", ...vals, id);
  else id = Number(run('INSERT INTO products(slug,name,summary,body,image_id,category_id,options,sku,seo,sort,published) VALUES(?,?,?,?,?,?,?,?,?,?,?)', ...vals).lastInsertRowid);
  audit(req.user, 'update', 'product', id, slug);
  flash(res, 'ok', 'تم الحفظ.');
  res.redirect('/admin/products/' + id);
}
contentRouter.post('/products/new', requirePerm('products'), (req, res) => saveProduct(req, res, null));
contentRouter.post('/products/:id(\\d+)', requirePerm('products'), (req, res) => saveProduct(req, res, Number(req.params.id)));
contentRouter.post('/products/:id(\\d+)/delete', requirePerm('products'), (req, res) => { run('DELETE FROM products WHERE id=?', req.params.id); audit(req.user, 'delete', 'product', req.params.id); flash(res, 'ok', 'حُذف المنتج.'); res.redirect('/admin/products'); });

const catForm = (req, c, isNew) => html`<form method="post" action="/admin/products/cat/${isNew ? 'new' : c.id}" class="card stack narrow">${csrf(req)}
  ${i18n('name', 'اسم التصنيف', J(c.name))}${i18n('descr', 'وصف (اختياري)', J(c.descr), { area: true, rows: 2 })}${mediaPick('image_id', 'صورة التصنيف', c.image_id)}
  ${fld('slug', 'الرابط', c.slug || '', { dir: 'ltr' })}${fld('sort', 'الترتيب', c.sort ?? 0, { type: 'number' })}${check('published', 'ظاهر', isNew ? true : c.published)}
  <button class="btn btn--ink">حفظ</button>${isNew ? '' : html` <button class="btn-s bad" formaction="/admin/products/cat/${c.id}/delete" data-confirm="حذف التصنيف؟ المنتجات تبقى بلا تصنيف.">حذف</button>`}</form>`;
contentRouter.get('/products/cat/new', requirePerm('products'), (req, res) => shell(req, res, { title: 'تصنيف جديد', active: '/admin/products', body: html`${pageHead('تصنيف جديد')}${catForm(req, {}, true)}` }));
contentRouter.get('/products/cat/:id(\\d+)', requirePerm('products'), (req, res) => {
  const c = one('SELECT * FROM categories WHERE id=?', req.params.id);
  if (!c) return res.redirect('/admin/products');
  shell(req, res, { title: tr(J(c.name)), active: '/admin/products', body: html`${pageHead(tr(J(c.name)))}${catForm(req, c, false)}` });
});
function saveCat(req, res, id) {
  const b = req.body, name = readI18n(b, 'name', 100);
  if (!name.ar) { flash(res, 'bad', 'اسم التصنيف بالعربية مطلوب.'); return res.redirect('/admin/products'); }
  let slug = slugify(b.slug || '').replace(/[^a-z0-9-]/g, '') || slugify(name.en || '').replace(/[^a-z0-9-]/g, '') || 'cat-' + Date.now().toString(36);
  const clash = one('SELECT id FROM categories WHERE slug=?', slug);
  if (clash && clash.id !== id) slug += '-' + Math.random().toString(36).slice(2, 5);
  const v = [slug, JSON.stringify(name), JSON.stringify(readI18n(b, 'descr', 300)), parseInt(b.image_id, 10) || null, parseInt(b.sort, 10) || 0, b.published === '1' ? 1 : 0];
  if (id) run('UPDATE categories SET slug=?,name=?,descr=?,image_id=?,sort=?,published=? WHERE id=?', ...v, id);
  else id = Number(run('INSERT INTO categories(slug,name,descr,image_id,sort,published) VALUES(?,?,?,?,?,?)', ...v).lastInsertRowid);
  audit(req.user, 'update', 'category', id, slug);
  flash(res, 'ok', 'تم الحفظ.');
  res.redirect('/admin/products');
}
contentRouter.post('/products/cat/new', requirePerm('products'), (req, res) => saveCat(req, res, null));
contentRouter.post('/products/cat/:id(\\d+)', requirePerm('products'), (req, res) => saveCat(req, res, Number(req.params.id)));
contentRouter.post('/products/cat/:id(\\d+)/delete', requirePerm('products'), (req, res) => { run('DELETE FROM categories WHERE id=?', req.params.id); audit(req.user, 'delete', 'category', req.params.id); flash(res, 'ok', 'حُذف التصنيف.'); res.redirect('/admin/products'); });
