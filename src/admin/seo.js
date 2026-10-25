import express from 'express';
import { html } from '../html.js';
import { all, run, getSettings, setSetting, audit, tr, J } from '../db.js';
import { requirePerm } from '../auth.js';
import { auditSeo, sitemapXml, robotsTxt } from '../seo.js';
import { getMedia, mediaUrl } from '../media.js';
import { shell, flash, csrf, fld, i18n, readI18n, pageHead } from './ui.js';

export const seoRouter = express.Router();
seoRouter.use(requirePerm('seo'));
const LV = { bad: ['مشكلة', 'bad'], warn: ['تنبيه', 'warn'], info: ['معلومة', 'info'] };

seoRouter.get('/', (req, res) => {
  const S = getSettings(), an = S.analytics || {}, seo = S.seo || {};
  const issues = auditSeo(), n = (l) => issues.filter((i) => i.level === l).length;
  const origin = `${req.protocol}://${req.get('host')}`;
  const siteUrl = (S.site?.url || '').replace(/\/$/, '') || origin;
  const og = getMedia(Number(seo.og));
  const reds = all('SELECT * FROM redirects ORDER BY id DESC');
  const pages = all('SELECT COUNT(*) n FROM pages WHERE published=1')[0].n;
  const sm = (sitemapXml(siteUrl).match(/<loc>/g) || []).length;
  shell(req, res, { title: 'تحسين محركات البحث', active: '/admin/seo', body: html`${pageHead('تحسين محركات البحث')}
  <section class="card"><div class="card__h"><h2>تقرير الفحص</h2></div>
    <div class="stats"><div class="stat ${n('bad') ? 'bad' : ''}"><b>${n('bad')}</b><span>مشكلات</span></div><div class="stat ${n('warn') ? 'warn' : ''}"><b>${n('warn')}</b><span>تنبيهات</span></div><div class="stat"><b>${n('info')}</b><span>ملاحظات</span></div><div class="stat"><b>${sm}</b><span>رابط في خريطة الموقع</span></div></div>
    ${issues.length ? html`<table class="tbl"><thead><tr><th></th><th>الصفحة</th><th>الملاحظة</th><th></th></tr></thead><tbody>${[...issues].sort((a, b) => 'bad warn info'.indexOf(a.level) - 'bad warn info'.indexOf(b.level)).map((i) => html`<tr><td><span class="pill l-${LV[i.level][1]}">${LV[i.level][0]}</span></td><td>${i.where}</td><td>${i.msg}</td><td><a href="${i.url}">معالجة</a></td></tr>`)}</tbody></table>` : html`<p class="ok">لا توجد ملاحظات. الموقع سليم تقنيًا من ناحية المحتوى.</p>`}
    <p class="hint">عنوان البحث والوصف وصورة المشاركة لكل صفحة تُعدَّل من محرر الصفحة (قسم «محركات البحث»). المنتجات لها حقولها في صفحة المنتج.</p></section>

  <form method="post" action="/admin/seo/global" class="card stack" id="global">${csrf(req)}<div class="card__h"><h2>الإعدادات العامة</h2></div>
    ${fld('site_url', 'رابط الموقع الرسمي', S.site?.url || '', { type: 'url', dir: 'ltr', attrs: 'placeholder="https://www.sumova.org"', hint: 'يُبنى عليه الرابط القانوني (canonical) وخريطة الموقع وبطاقات المشاركة. اكتبه بالشكل النهائي بدون / في الآخر.' })}
    ${i18n('seo_desc', 'الوصف الافتراضي للموقع', seo.desc, { area: true, rows: 3, counter: '160', hint: 'يُستخدم للصفحات التي لا وصف لها.' })}
    <div class="f mediafield" data-media><span class="lbl">صورة المشاركة الافتراضية</span><div class="mediabox"><div class="thumb">${og ? html`<img src="${mediaUrl(og.id, 480)}" alt="" width="120" height="80">` : html`<span class="empty">لا توجد</span>`}</div>
      <div class="mbtns"><input type="hidden" name="seo_og" value="${og ? og.id : ''}"><button type="button" class="btn-s" data-pick>اختيار</button><button type="button" class="linkbtn" data-clear ${og ? '' : 'hidden'}>إزالة</button></div></div></div>
    <div class="cols">${fld('ga4', 'معرّف Google Analytics 4', an.ga4 || '', { dir: 'ltr', attrs: 'placeholder="G-XXXXXXXXXX" pattern="G-[A-Z0-9]+"' })}
    ${fld('search_console', 'رمز التحقق من Google Search Console', an.search_console || '', { dir: 'ltr', hint: 'قيمة content من وسم التحقق.' })}
    ${fld('bing', 'رمز التحقق من Bing Webmaster', an.bing || '', { dir: 'ltr' })}</div>
    <button class="btn btn--ink">حفظ</button></form>

  <section class="card" id="redirects"><div class="card__h"><h2>التحويلات (301)</h2></div>
    <p class="hint">عند تغيير رابط صفحة يُضاف تحويل تلقائي. أضف هنا أي رابط قديم تريد توجيهه.</p>
    ${reds.length ? html`<table class="tbl"><thead><tr><th>من</th><th>إلى</th><th>الزيارات</th><th></th></tr></thead><tbody>${reds.map((r) => html`<tr><td dir="ltr">${r.from_path}</td><td dir="ltr">${r.to_path}</td><td>${r.hits}</td><td><form method="post" action="/admin/seo/redirects/${r.id}/delete">${csrf(req)}<button class="linkbtn bad">حذف</button></form></td></tr>`)}</tbody></table>` : html`<p class="empty">لا توجد تحويلات.</p>`}
    <form method="post" action="/admin/seo/redirects" class="inline">${csrf(req)}<input name="from" dir="ltr" placeholder="/old-page" required aria-label="من"><input name="to" dir="ltr" placeholder="/new-page" required aria-label="إلى"><button class="btn-s">إضافة</button></form></section>

  <section class="card"><div class="card__h"><h2>ملفات تلقائية</h2></div><ul class="plain code" dir="ltr"><li><a href="/sitemap.xml" target="_blank" rel="noopener">${siteUrl}/sitemap.xml</a> – ${sm} URL, ${pages} pages</li><li><a href="/robots.txt" target="_blank" rel="noopener">${siteUrl}/robots.txt</a></li></ul>
    <p class="hint">تُحدَّث تلقائيًا مع كل نشر. أرسل رابط خريطة الموقع إلى Google Search Console بعد إطلاق الموقع.</p>
    <pre class="pre code" dir="ltr">${robotsTxt(siteUrl)}</pre></section>` });
});

seoRouter.post('/global', (req, res) => {
  const b = req.body, S = getSettings();
  const u = String(b.site_url || '').trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\/[^\s/]+(\/[^\s]*)?$/i.test(u)) { flash(res, 'bad', 'رابط الموقع غير صالح. مثال: https://www.sumova.org'); return res.redirect('/admin/seo#global'); }
  const clean = (k, re) => { const v = String(b[k] || '').trim().slice(0, 120); return re.test(v) ? v : ''; };
  setSetting('site', { ...(S.site || {}), url: u });
  setSetting('seo', { ...(S.seo || {}), desc: readI18n(b, 'seo_desc', 320), og: parseInt(b.seo_og, 10) || null });
  setSetting('analytics', { ga4: clean('ga4', /^G-[A-Z0-9]{4,}$/), search_console: clean('search_console', /^[\w\-]{10,}$/), bing: clean('bing', /^[\w\-]{10,}$/) });
  audit(req.user, 'update', 'seo', null, 'الإعدادات العامة');
  flash(res, 'ok', 'تم حفظ إعدادات SEO.');
  res.redirect('/admin/seo#global');
});
const path_ = (v) => { v = String(v || '').trim().slice(0, 300); return /^\/[^\s]*$/.test(v) && !v.startsWith('//') ? v.replace(/(.)\/$/, '$1') : ''; };
seoRouter.post('/redirects', (req, res) => {
  const from = path_(req.body.from), to = String(req.body.to || '').trim().slice(0, 300);
  if (!from || !(path_(to) || /^https?:\/\//i.test(to)) || from === to || from.startsWith('/admin')) { flash(res, 'bad', 'اكتب مسارين صحيحين يبدآن بـ / ولا يتطابقان.'); return res.redirect('/admin/seo#redirects'); }
  run('INSERT INTO redirects(from_path,to_path,code) VALUES(?,?,301) ON CONFLICT(from_path) DO UPDATE SET to_path=excluded.to_path', from, to);
  audit(req.user, 'create', 'redirect', null, `${from} → ${to}`);
  flash(res, 'ok', 'أُضيف التحويل.');
  res.redirect('/admin/seo#redirects');
});
seoRouter.post('/redirects/:id(\\d+)/delete', (req, res) => { run('DELETE FROM redirects WHERE id=?', req.params.id); audit(req.user, 'delete', 'redirect', req.params.id); res.redirect('/admin/seo#redirects'); });
