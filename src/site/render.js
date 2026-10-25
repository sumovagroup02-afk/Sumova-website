import { html, raw, jsonForScript } from '../html.js';
import { tr, hasLang, getSettings, all, J } from '../db.js';
import { img, mediaUrl, ogUrl, getMedia } from '../media.js';

export const UI = {
  ar: {
    menu: 'القائمة', skip: 'تخطَّ إلى المحتوى', quote: 'اطلب عرض سعر', home: 'الرئيسية', more: 'اعرف أكثر',
    lang: 'EN', langName: 'English', rights: 'جميع الحقوق محفوظة', links: 'روابط', contact: 'تواصل معنا', cr: 'السجل التجاري',
    phone: 'الهاتف', email: 'البريد الإلكتروني', address: 'العنوان', hours: 'ساعات العمل', follow: 'تابعنا', whatsapp: 'واتساب', waChat: 'راسلنا على واتساب',
    name: 'الاسم', org: 'الجهة أو الشركة', mobile: 'رقم الجوال', message: 'تفاصيل الطلب', send: 'إرسال الطلب', sendMsg: 'إرسال الرسالة',
    kindQuote: 'عرض سعر', kindCatering: 'إعاشة', people: 'عدد الأشخاص', days: 'عدد الأيام', place: 'موقع التقديم', date: 'تاريخ البدء',
    msgContact: 'رسالتك', onMap: 'افتح الموقع على الخريطة', chooseFiles: 'اختر الملفات', noFiles: 'لم تُختر ملفات', afterTitle: 'بعد إرسال الطلب', after: ['يصلك رقم الطلب فورًا لتتابعه من صفحة «متابعة طلب».', 'يدرس فريقنا الطلب ويرفع عرض السعر بصيغة PDF.', 'تقبل العرض أو ترفضه من الصفحة نفسها.'], callUs: 'تفضّل الاتصال؟', files: 'ملفات مرفقة (اختياري)', filesHint: 'PDF أو صور أو Excel أو Word، حتى 8 ميجابايت لكل ملف.',
    cart: 'المنتجات المطلوبة', qty: 'الكمية', remove: 'حذف', add: 'أضف إلى الطلب', added: 'أُضيف إلى الطلب',
    required: 'هذا الحقل مطلوب', thanks: 'استلمنا طلبك', thanksText: 'رقم طلبك', thanksNext: 'احتفظ بهذا الرقم. تتابع به حالة الطلب وتستلم عرض السعر من صفحة المتابعة.',
    track: 'متابعة طلب', trackBtn: 'عرض الحالة', code: 'رقم الطلب', status: 'الحالة', accept: 'قبول العرض', reject: 'رفض العرض', downloadQuote: 'تنزيل عرض السعر',
    notFound: 'الصفحة غير موجودة', notFoundText: 'ربما تغيّر الرابط أو حُذفت الصفحة.', toHome: 'العودة إلى الرئيسية',
    allCats: 'الكل', product: 'المنتج', options: 'الخيارات', next: 'التالي', privacy: 'سياسة الخصوصية', terms: 'الشروط والأحكام',
    privNote: 'نستخدم بياناتك للرد على طلبك فقط.',
  },
  en: {
    menu: 'Menu', skip: 'Skip to content', quote: 'Request a quote', home: 'Home', more: 'Learn more',
    lang: 'ع', langName: 'العربية', rights: 'All rights reserved', links: 'Links', contact: 'Contact us', cr: 'Commercial Registration',
    phone: 'Phone', email: 'Email', address: 'Address', hours: 'Working hours', follow: 'Follow us', whatsapp: 'WhatsApp', waChat: 'Chat on WhatsApp',
    name: 'Name', org: 'Company or organisation', mobile: 'Mobile number', message: 'Request details', send: 'Send request', sendMsg: 'Send message',
    kindQuote: 'Quotation', kindCatering: 'Catering', people: 'Number of people', days: 'Number of days', place: 'Service location', date: 'Start date',
    msgContact: 'Your message', onMap: 'Open on the map', chooseFiles: 'Choose files', noFiles: 'No files chosen', afterTitle: 'After you send', after: ['You get a request number at once to follow it on the tracking page.', 'Our team reviews it and posts a PDF quotation.', 'You accept or decline from the same page.'], callUs: 'Prefer to call?', files: 'Attachments (optional)', filesHint: 'PDF, images, Excel or Word, up to 8 MB each.',
    cart: 'Requested products', qty: 'Quantity', remove: 'Remove', add: 'Add to request', added: 'Added to request',
    required: 'This field is required', thanks: 'We received your request', thanksText: 'Your request number', thanksNext: 'Keep this number. Use it to follow the request and receive our quotation on the tracking page.',
    track: 'Track a request', trackBtn: 'Show status', code: 'Request number', status: 'Status', accept: 'Accept quotation', reject: 'Decline quotation', downloadQuote: 'Download quotation',
    notFound: 'Page not found', notFoundText: 'The link may have changed or the page was removed.', toHome: 'Back to home',
    allCats: 'All', product: 'Product', options: 'Options', next: 'Next', privacy: 'Privacy policy', terms: 'Terms',
    privNote: 'We use your details only to reply to your request.',
  },
};

export const STATUS = {
  new: { ar: 'جديد', en: 'New' },
  pricing: { ar: 'قيد التسعير', en: 'Being priced' },
  quoted: { ar: 'أُرسل العرض', en: 'Quotation sent' },
  accepted: { ar: 'قُبل العرض', en: 'Quotation accepted' },
  rejected: { ar: 'رُفض العرض', en: 'Quotation declined' },
  confirmed: { ar: 'طلب مؤكد', en: 'Order confirmed' },
  closed: { ar: 'مغلق', en: 'Closed' },
};

export function makeCtx(req, lang) {
  const S = getSettings();
  const L = (p = '/') => (lang === 'en' ? (p === '/' ? '/en' : `/en${p}`) : p);
  return {
    lang, dir: lang === 'ar' ? 'rtl' : 'ltr', S, L, ui: UI[lang],
    t: (v) => tr(v, lang),
    siteUrl: (S.site?.url || process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, ''),
    req,
  };
}

const paras = (text) => String(text || '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
const lines = (text) => String(text || '').split(/\n/).map((s) => s.trim()).filter(Boolean);
const P = (text) => paras(text).map((p) => html`<p>${p}</p>`);
const href = (c, url) => (!url ? '#' : /^(https?:|mailto:|tel:|#)/.test(url) ? url : c.L(url));
// Saudi mobile → wa.me link (05xxxxxxxx / 5xxxxxxxx / 9665xxxxxxxx)
export const waUrl = (phone) => { const d = String(phone || '').replace(/\D/g, ''); const n = d.startsWith('0') ? '966' + d.slice(1) : d.length === 9 ? '966' + d : d; return n.length >= 11 ? `https://wa.me/${n}` : ''; };
const WA_ICON = raw('<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l1.3-3.9A8.5 8.5 0 1 1 8.2 19z"/><path d="M9.2 8.6c-.3 2.9 2.3 5.9 5.6 6.2l1.1-1.4-1.9-1-.9.8a4 4 0 0 1-2.4-2.4l.8-.9-1-1.9z"/></svg>');

// ───────── blocks
const R = {};

R.hero = (c, d) => {
  const figs = (d.figures || []).filter((f) => f.value);
  const h = lines(c.t(d.headline));
  return html`<section class="hero on-ink">
    <div class="hero__pic">${img(d.media, { lang: c.lang, eager: true, sizes: '100vw', fetchpriority: 'high' })}</div>
    <div class="wrap hero__body">
      <h1>${h.map((l) => html`<span>${l}</span>`)}</h1>
      <p class="lede">${c.t(d.sub)}</p>
      <div class="hero__cta">
        ${c.t(d.cta1_label) ? html`<a class="btn btn--gold" href="${href(c, d.cta1_url)}">${c.t(d.cta1_label)}</a>` : ''}
        ${c.t(d.cta2_label) ? html`<a class="btn btn--line" href="${href(c, d.cta2_url)}">${c.t(d.cta2_label)}</a>` : ''}
      </div>
    </div>
    ${figs.length ? html`<div class="ledger"><div class="wrap"><ul style="--n:${figs.length}">${figs.map((f) => html`<li>
      <span class="num">${f.value}<span class="unit">${c.t(f.unit)}</span></span><span class="lab">${c.t(f.label)}</span></li>`)}</ul></div></div>` : ''}
  </section>`;
};

R.page_head = (c, d, ctx2) => html`<section class="phead on-ink ${d.media ? '' : 'no-img'}">
  <div class="wrap phead__in">
    <div>
      ${ctx2?.crumbs ? html`<nav class="crumbs" aria-label="breadcrumb"><a href="${c.L('/')}">${c.ui.home}</a><span aria-hidden="true">/</span><span>${c.t(d.title)}</span></nav>` : ''}
      <h1>${c.t(d.title)}</h1>
      ${c.t(d.lede) ? html`<p class="lede">${c.t(d.lede)}</p>` : ''}
    </div>
    ${d.media ? html`<div class="phead__pic">${img(d.media, { lang: c.lang, eager: true, sizes: '(min-width:820px) 40vw, 100vw' })}</div>` : ''}
  </div></section>`;

R.strips = (c, d, _x, idx) => {
  const items = (d.items || []).filter((i) => c.t(i.title));
  if (!items.length) return '';
  return html`<section class="sec" id="operations"><div class="wrap">
    <div class="strips-head"><h2>${c.t(d.title)}</h2>${c.t(d.intro) ? html`<p class="lede">${c.t(d.intro)}</p>` : ''}</div>
    <div class="strips" data-strips>
      ${items.map((i, n) => html`<article class="strip ${n === 0 ? 'is-active' : ''}">
        ${i.media ? html`<div class="strip__media">${img(i.media, { lang: c.lang, sizes: '(min-width:900px) 60vw, 100vw' })}</div>` : html`<div class="strip__big" aria-hidden="true">${i.big || ''}</div>`}
        <button type="button" class="strip__toggle" aria-expanded="${n === 0 ? 'true' : 'false'}" aria-label="${c.t(i.title)}"></button>
        <div class="strip__in"><h3>${c.t(i.title)}</h3>
          <div class="strip__text"><p>${c.t(i.text)}</p>${i.url ? html`<a class="more" href="${href(c, i.url)}">${c.ui.more}</a>` : ''}</div>
        </div></article>`)}
    </div></div></section>`;
};

R.steps = (c, d) => {
  const items = (d.items || []).filter((i) => c.t(i.title));
  if (!items.length) return '';
  return html`<section class="sec sec--alt"><div class="wrap">
    <h2>${c.t(d.title)}</h2>
    <ol class="steps" style="--n:${items.length}">${items.map((i) => html`<li><h3>${c.t(i.title)}</h3><p>${c.t(i.text)}</p></li>`)}</ol>
    ${c.t(d.cta_label) ? html`<p style="margin-top:36px"><a class="btn btn--ink" href="${href(c, d.cta_url)}">${c.t(d.cta_label)}</a></p>` : ''}
  </div></section>`;
};

R.text_image = (c, d) => html`<section class="sec"><div class="wrap"><div class="ti ${d.side === 'start' ? 'side-start' : ''}">
  <div><h2>${c.t(d.title)}</h2>${P(c.t(d.body))}
    ${(d.facts || []).filter((f) => f.value).length ? html`<ul class="facts">${d.facts.filter((f) => f.value).map((f) => html`<li><div class="v">${f.value}</div><div class="l">${c.t(f.label)}</div></li>`)}</ul>` : ''}
    ${c.t(d.cta_label) ? html`<p style="margin-top:28px"><a class="btn btn--ink" href="${href(c, d.cta_url)}">${c.t(d.cta_label)}</a></p>` : ''}
  </div>
  ${d.media ? html`<div class="ti__pic">${img(d.media, { lang: c.lang, sizes: '(min-width:860px) 46vw, 100vw' })}</div>` : ''}
</div></div></section>`;

R.facts = (c, d) => {
  const items = (d.items || []).filter((i) => i.value);
  if (!items.length) return '';
  return html`<section class="sec sec--alt"><div class="wrap"><h2>${c.t(d.title)}</h2>
    <ul class="facts">${items.map((i) => html`<li><div class="v">${i.value}<span class="u">${c.t(i.unit)}</span></div><div class="l">${c.t(i.label)}</div></li>`)}</ul></div></section>`;
};

R.richtext = (c, d) => html`<section class="sec sec--rt"><div class="wrap"><div class="prose"><h2>${c.t(d.title)}</h2>${P(c.t(d.body))}</div></div></section>`;

R.cta = (c, d) => html`<section class="cta on-ink"><div class="wrap cta__in">
  <div><h2>${c.t(d.title)}</h2>${c.t(d.text) ? html`<p>${c.t(d.text)}</p>` : ''}</div>
  ${c.t(d.cta_label) ? html`<a class="btn btn--gold" href="${href(c, d.cta_url)}">${c.t(d.cta_label)}</a>` : ''}</div></section>`;

R.faq = (c, d) => {
  const items = (d.items || []).filter((i) => c.t(i.q));
  if (!items.length) return '';
  return html`<section class="sec"><div class="wrap"><div class="prose faq"><h2>${c.t(d.title)}</h2>
    ${items.map((i) => html`<details><summary>${c.t(i.q)}</summary><p>${c.t(i.a)}</p></details>`)}</div></div></section>`;
};

R.logos = (c, d) => {
  const items = (d.items || []).filter((i) => i.media);
  if (!items.length) return '';
  return html`<section class="sec sec--alt"><div class="wrap"><h2>${c.t(d.title)}</h2>
    <ul class="logos">${items.map((i) => html`<li>${img(i.media, { lang: c.lang, alt: c.t(i.name), sizes: '180px' })}</li>`)}</ul></div></section>`;
};

R.accreditations = (c, d) => {
  const items = (d.items || []).filter((i) => c.t(i.name));
  if (!items.length) return '';
  return html`<section class="sec"><div class="wrap"><h2>${c.t(d.title)}</h2>
    <ul class="accr">${items.map((i) => html`<li><b>${c.t(i.name)}</b>${c.t(i.text)}</li>`)}</ul></div></section>`;
};

R.catalog = (c, d, x) => {
  const cats = all('SELECT * FROM categories WHERE published=1 ORDER BY sort,id');
  const sel = x?.query?.c ? cats.find((k) => k.slug === x.query.c) : null;
  const prods = all(`SELECT * FROM products WHERE published=1 ${sel ? 'AND category_id=' + Number(sel.id) : ''} ORDER BY sort,id`);
  return html`<section class="sec"><div class="wrap"><h2>${c.t(d.title)}</h2>${c.t(d.intro) ? html`<p class="lede">${c.t(d.intro)}</p>` : ''}
    ${cats.length > 1 ? html`<nav class="chips" aria-label="${c.t(d.title)}"><a class="chip" href="${c.L(x.path)}" aria-current="${!sel}">${c.ui.allCats}</a>
      ${cats.map((k) => html`<a class="chip" href="${c.L(x.path)}?c=${k.slug}" aria-current="${sel?.id === k.id}">${c.t(J(k.name))}</a>`)}</nav>` : ''}
    ${prods.length ? html`<ul class="cards">${prods.map((p) => {
      const nm = c.t(J(p.name));
      return html`<li class="card"><a class="stretch" href="${c.L('/products/' + p.slug)}" tabindex="-1" aria-hidden="true"><div class="card__pic">${p.image_id ? img(p.image_id, { lang: c.lang, alt: nm, sizes: '(min-width:700px) 25vw, 100vw' }) : ''}</div></a>
        <div class="card__body"><h3><a class="stretch" href="${c.L('/products/' + p.slug)}">${nm}</a></h3><p>${c.t(J(p.summary))}</p>
        <button type="button" class="btn btn--ink" data-add data-id="${p.id}" data-name="${nm}">${c.ui.add}</button></div></li>`;
    })}</ul>` : html`<div class="empty">${P(c.t(d.empty))}<p><a class="btn btn--ink" href="${c.L('/request-quote')}">${c.ui.quote}</a></p></div>`}
  </div></section>`;
};

export function fieldErr(errs, k, c) { return errs?.[k] ? html`<div class="err" id="e-${k}">${errs[k]}</div>` : ''; }

function formFields(c, vals = {}, errs = {}, kind = 'quote') {
  const f = (k, label, type = 'text', extra = '') => html`<div class="fld"><label for="f-${k}">${label}</label>
    <input id="f-${k}" name="${k}" type="${type}" value="${vals[k] || ''}" ${raw(errs[k] ? `aria-invalid="true" aria-describedby="e-${k}"` : '')} ${raw(extra)}>${fieldErr(errs, k, c)}</div>`;
  return { f };
}

R.quote_form = (c, d, x) => {
  const vals = x?.vals || {}, errs = x?.errs || {};
  const fixed = d.kind === 'catering';
  const kind = fixed ? 'catering' : (vals.kind || d.kind || 'quote');
  const ct = c.S.contact || {};
  const { f } = formFields(c, vals, errs, kind);
  const ts = Date.now();
  return html`<section class="sec"><div class="wrap"><div class="prose" style="max-width:760px"><h2>${c.t(d.title)}</h2>${c.t(d.intro) ? html`<p class="lede">${c.t(d.intro)}</p>` : ''}</div>
    ${x?.formError ? html`<div class="notice bad" role="alert" style="max-width:760px;margin-top:20px">${x.formError}</div>` : ''}
    <div class="qf"><form class="form" method="post" action="${c.L('/request')}" enctype="multipart/form-data" data-request-form style="margin-top:28px" novalidate>
      <input type="hidden" name="ts" value="${ts}">
      <div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
      ${fixed ? html`<input type="hidden" name="kind" value="catering">` : html`<fieldset class="fld" style="border:0;padding:0;margin:0"><legend>${c.ui.quote}</legend>
        <div class="seg"><label><input type="radio" name="kind" value="quote" ${kind === 'quote' ? 'checked' : ''}><span>${c.ui.kindQuote}</span></label>
        <label><input type="radio" name="kind" value="catering" ${kind === 'catering' ? 'checked' : ''}><span>${c.ui.kindCatering}</span></label></div></fieldset>`}
      <div class="cartbox" data-cart hidden><strong>${c.ui.cart}</strong><ul data-cart-list></ul><input type="hidden" name="items" value="[]" data-cart-input></div>
      <div class="row2">${f('name', c.ui.name, 'text', 'required autocomplete="name"')}${f('org', c.ui.org, 'text', 'autocomplete="organization"')}</div>
      <div class="row2">${f('phone', c.ui.mobile, 'tel', 'required inputmode="tel" autocomplete="tel" dir="ltr"')}${f('email', c.ui.email, 'email', 'autocomplete="email" dir="ltr"')}</div>
      <div data-catering ${kind === 'catering' ? '' : 'hidden'}>
        <div class="row2">${f('people', c.ui.people, 'number', 'min="1" inputmode="numeric"')}${f('days', c.ui.days, 'number', 'min="1" inputmode="numeric"')}</div>
        <div class="row2" style="margin-top:18px">${f('place', c.ui.place)}${f('start', c.ui.date, 'date')}</div>
      </div>
      <div class="fld"><label for="f-message">${c.ui.message}</label><textarea id="f-message" name="message" ${raw(errs.message ? 'aria-invalid="true"' : '')}>${vals.message || ''}</textarea>${fieldErr(errs, 'message', c)}</div>
      <div class="fld"><label for="f-files">${c.ui.files}</label><div class="filepick"><input id="f-files" class="vh" name="files" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.docx,.doc" data-files aria-describedby="f-files-hint"><label for="f-files" class="btn btn--line" aria-hidden="true">${c.ui.chooseFiles}</label><span data-files-out>${c.ui.noFiles}</span></div><div class="hint" id="f-files-hint">${c.ui.filesHint}</div>${fieldErr(errs, 'files', c)}</div>
      <p class="hint" style="font-size:.9rem;color:var(--text-soft)">${c.ui.privNote}</p>
      <div><button class="btn btn--ink" type="submit">${c.ui.send}</button></div>
    </form>
    <aside class="qf__aside"><h3>${c.ui.afterTitle}</h3><ol>${c.ui.after.map((t) => html`<li>${t}</li>`)}</ol>
      ${ct.phone ? html`<p class="qf__call">${c.ui.callUs}<br><a href="tel:${ct.phone.replace(/\s/g, '')}" dir="ltr">${ct.phone}</a></p>` : ''}</aside></div></div></section>`;
};

R.contact = (c, d, x) => {
  const S = c.S, ct = S.contact || {};
  const vals = x?.vals || {}, errs = x?.errs || {};
  const { f } = formFields(c, vals, errs);
  return html`<section class="sec"><div class="wrap contact">
    <div><h2>${c.t(d.title)}</h2>${c.t(d.intro) ? html`<p class="lede">${c.t(d.intro)}</p>` : ''}
      <dl>
        ${ct.phone ? html`<dt>${c.ui.phone}</dt><dd><a href="tel:${ct.phone.replace(/\s/g, '')}" dir="ltr">${ct.phone}</a></dd>` : ''}
        ${waUrl(ct.whatsapp) ? html`<dt>${c.ui.whatsapp}</dt><dd><a class="btn btn--ink btn--wa" href="${waUrl(ct.whatsapp)}" target="_blank" rel="noopener" data-wa>${WA_ICON}<span>${c.ui.waChat}</span></a></dd>` : ''}
        ${ct.email ? html`<dt>${c.ui.email}</dt><dd><a href="mailto:${ct.email}" dir="ltr">${ct.email}</a></dd>` : ''}
        ${c.t(ct.address) ? html`<dt>${c.ui.address}</dt><dd>${c.t(ct.address)}${/^https:\/\//.test(ct.map_url || '') ? html`<br><a href="${ct.map_url}" target="_blank" rel="noopener">${c.ui.onMap} ↗</a>` : ''}</dd>` : ''}
        ${c.t(ct.hours) ? html`<dt>${c.ui.hours}</dt><dd>${c.t(ct.hours)}</dd>` : ''}
      </dl></div>
    <div>
      ${x?.formError ? html`<div class="notice bad" role="alert" style="margin-bottom:18px">${x.formError}</div>` : ''}
      <form class="form" method="post" action="${c.L('/contact-send')}" novalidate>
        <input type="hidden" name="ts" value="${Date.now()}">
        <div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
        <div class="row2">${f('name', c.ui.name, 'text', 'required autocomplete="name"')}${f('phone', c.ui.mobile, 'tel', 'required inputmode="tel" autocomplete="tel" dir="ltr"')}</div>
        ${f('email', c.ui.email, 'email', 'autocomplete="email" dir="ltr"')}
        <div class="fld"><label for="f-message">${c.ui.msgContact}</label><textarea id="f-message" name="message" required ${raw(errs.message ? 'aria-invalid="true" aria-describedby="e-message"' : '')}>${vals.message || ''}</textarea>${fieldErr(errs, 'message', c)}</div>
        <div><button class="btn btn--ink" type="submit">${c.ui.sendMsg}</button></div>
      </form></div></div></section>`;
};

export function renderBlock(c, block, x = {}) {
  const fn = R[block.type];
  if (!fn) return '';
  try { return fn(c, block.data || {}, x); } catch (e) { console.error('block render failed', block.type, e); return ''; }
}

// ───────── layout
function jsonLdFor(c, page, seo, canonical) {
  const S = c.S, ct = S.contact || {};
  const org = { '@context': 'https://schema.org', '@type': 'Organization', name: c.t(S.brand?.name) || 'SUMOVA', url: c.siteUrl, logo: `${c.siteUrl}/brand/logo-ar-onlight.svg`,
    ...(ct.phone ? { telephone: ct.phone } : {}), ...(ct.email ? { email: ct.email } : {}),
    ...(Object.values(S.social || {}).filter(Boolean).length ? { sameAs: Object.values(S.social).filter((u) => /^https?:/.test(u)) } : {}),
    ...(c.t(ct.address) ? { address: { '@type': 'PostalAddress', streetAddress: c.t(ct.address), ...(c.t(ct.city) ? { addressLocality: c.t(ct.city) } : {}), addressCountry: 'SA' } } : {}),
    ...(ct.geo?.lat ? { location: { '@type': 'Place', geo: { '@type': 'GeoCoordinates', latitude: ct.geo.lat, longitude: ct.geo.lng }, ...(ct.map_url ? { hasMap: ct.map_url } : {}) } } : {}) };
  const out = [org, { '@context': 'https://schema.org', '@type': 'WebSite', name: c.t(S.brand?.name) || 'SUMOVA', url: c.siteUrl, inLanguage: c.lang }];
  if (page && page.slug !== 'home') {
    out.push({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: c.ui.home, item: c.siteUrl + c.L('/') },
      { '@type': 'ListItem', position: 2, name: seo.h1 || seo.title, item: canonical } ] });
  }
  const faq = (page?.blocks || []).find((b) => b.type === 'faq');
  const fi = (faq?.data?.items || []).filter((i) => c.t(i.q) && c.t(i.a));
  if (fi.length) out.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: fi.map((i) => ({ '@type': 'Question', name: c.t(i.q), acceptedAnswer: { '@type': 'Answer', text: c.t(i.a) } })) });
  return out;
}

export function navPages(c) {
  return all("SELECT slug,title,nav_label FROM pages WHERE published=1 AND show_in_nav=1 ORDER BY sort,id").map((p) => ({
    slug: p.slug, label: c.t(J(p.nav_label)) || c.t(J(p.title)),
  }));
}

// Simple line icons for the footer social links (currentColor, 20px)
const SOC = {
  LinkedIn: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10v7M8 7v.01M12 17v-4a2 2 0 0 1 4 0v4M12 10v7"/>',
  Instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5v.01"/>',
  YouTube: '<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="M10 9.5v5l4.5-2.5z"/>',
  TikTok: '<path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3c.5 2.6 2.2 4.2 5 4.5"/>',
  Snapchat: '<path d="M12 3c3 0 5 2.2 5 5.2v2.3l1.8.6c.5.2.4.8-.1 1l-1.9.7c.6 1.6 1.8 2.8 3.2 3.3-.7.7-1.9.8-2.7.9-.2.6-.3 1.2-.8 1.3-.9.1-1.7-.4-2.8.2-.8.5-1.4 1-2.7 1s-1.9-.5-2.7-1c-1.1-.6-1.9-.1-2.8-.2-.5-.1-.6-.7-.8-1.3-.8-.1-2-.2-2.7-.9 1.4-.5 2.6-1.7 3.2-3.3l-1.9-.7c-.5-.2-.6-.8-.1-1l1.8-.6V8.2C7 5.2 9 3 12 3z"/>',
  X: '<path d="M4 4l16 16M20 4L4 20"/>',
};
const socIcon = (k) => raw(SOC[k] ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SOC[k]}</svg>` : '');

export function layout(c, { page, seo, body, path, noindex = false, altPath, extraLd = [] }) {
  const S = c.S, ct = S.contact || {}, an = S.analytics || {};
  const canonical = c.siteUrl + c.L(path === '/' ? '/' : path);
  const pathNoLang = path;
  const nav = navPages(c);
  const logo = c.lang === 'ar' ? '/brand/logo-ar-onlight.svg' : '/brand/logo-en-onlight.svg';
  const ogImg = seo.og ? c.siteUrl + ogUrl(seo.og) : '';
  const alt = altPath ?? pathNoLang;
  const lds = [...jsonLdFor(c, page, seo, canonical), ...extraLd];
  const enAvailable = alt !== null && seo.enOk !== false;
  return html`<!doctype html>
<html lang="${c.lang}" dir="${c.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${seo.title}</title>
<meta name="description" content="${seo.desc}">
<link rel="canonical" href="${canonical}">
${noindex || seo.noindex ? raw('<meta name="robots" content="noindex,nofollow">') : raw('<meta name="robots" content="index,follow,max-image-preview:large">')}
${enAvailable ? html`<link rel="alternate" hreflang="ar" href="${c.siteUrl}${alt}"><link rel="alternate" hreflang="en" href="${c.siteUrl}${alt === '/' ? '/en' : '/en' + alt}"><link rel="alternate" hreflang="x-default" href="${c.siteUrl}${alt}">` : ''}
<meta property="og:type" content="website"><meta property="og:site_name" content="${c.t(S.brand?.name)}"><meta property="og:title" content="${seo.title}"><meta property="og:description" content="${seo.desc}">
<meta property="og:url" content="${canonical}"><meta property="og:locale" content="${c.lang === 'ar' ? 'ar_SA' : 'en_US'}">
${ogImg ? html`<meta property="og:image" content="${ogImg}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:image" content="${ogImg}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#051427">
${an.search_console ? html`<meta name="google-site-verification" content="${an.search_console}">` : ''}
${an.bing ? html`<meta name="msvalidate.01" content="${an.bing}">` : ''}
<link rel="icon" href="/brand/favicon.svg" type="image/svg+xml"><link rel="icon" href="/brand/favicon-32.png" sizes="32x32" type="image/png"><link rel="apple-touch-icon" href="/brand/apple-touch-icon.png"><link rel="manifest" href="/site.webmanifest">
<link rel="preload" href="/fonts/tajawal-arabic-800-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/site.css?v=${raw(process.env.ASSET_V || '1')}">
${lds.map((o) => html`<script type="application/ld+json">${jsonForScript(o)}</script>`)}
${an.ga4 ? html`<script async src="https://www.googletagmanager.com/gtag/js?id=${an.ga4}" nonce="${c.req.res.locals.nonce}"></script><script nonce="${c.req.res.locals.nonce}">window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${an.ga4}');</script>` : ''}
</head>
<body>
<a class="skip" href="#main">${c.ui.skip}</a>
<header class="hdr"><div class="wrap hdr__in">
  <a class="hdr__logo" href="${c.L('/')}" aria-label="${c.t(S.brand?.name)}"><img src="${logo}" alt="${c.t(S.brand?.name)}" width="144" height="40"></a>
  <button class="menu-btn" type="button" aria-expanded="false" aria-controls="nav" aria-label="${c.ui.menu}" data-menu><span></span></button>
  <nav class="nav" id="nav" aria-label="${c.ui.menu}">${nav.map((n) => html`<a href="${c.L(n.slug === 'home' ? '/' : '/' + n.slug)}" ${raw((n.slug === 'home' ? path === '/' : path === '/' + n.slug) ? 'aria-current="page"' : '')}>${n.label}</a>`)}</nav>
  <div class="hdr__tools">
    ${enAvailable ? html`<a class="lang" href="${c.lang === 'ar' ? (alt === '/' ? '/en' : '/en' + alt) : alt}" hreflang="${c.lang === 'ar' ? 'en' : 'ar'}" lang="${c.lang === 'ar' ? 'en' : 'ar'}" title="${c.ui.langName}">${c.ui.lang}</a>` : ''}
    <a class="btn btn--gold" href="${c.L('/request-quote')}">${c.ui.quote}</a>
  </div></div></header>
<main id="main">${body}</main>
${waUrl(ct.whatsapp) ? html`<a class="wa-fab" href="${waUrl(ct.whatsapp)}" target="_blank" rel="noopener" aria-label="${c.ui.waChat}" title="${c.ui.waChat}" data-wa-fab>${WA_ICON}</a>` : ''}
<footer class="ftr on-ink"><div class="wrap">
  <div class="ftr__grid">
    <div><img src="/brand/logo-${c.lang === 'ar' ? 'ar' : 'en'}-onink.svg" alt="${c.t(S.brand?.name)}" width="173" height="48">${c.t(S.footer?.about) ? html`<p>${c.t(S.footer.about)}</p>` : ''}</div>
    <div><h4>${c.ui.links}</h4><ul>${nav.map((n) => html`<li><a href="${c.L(n.slug === 'home' ? '/' : '/' + n.slug)}">${n.label}</a></li>`)}<li><a href="${c.L('/track')}">${c.ui.track}</a></li><li><a href="${c.L('/privacy')}">${c.ui.privacy}</a></li><li><a href="${c.L('/terms')}">${c.ui.terms}</a></li></ul></div>
    <div><h4>${c.ui.contact}</h4><ul>
      ${ct.phone ? html`<li><a href="tel:${ct.phone.replace(/\s/g, '')}" dir="ltr">${ct.phone}</a></li>` : ''}
      ${ct.email ? html`<li><a href="mailto:${ct.email}" dir="ltr">${ct.email}</a></li>` : ''}
      ${c.t(ct.address) ? html`<li>${c.t(ct.address)}</li>` : ''}
      </ul>
      ${Object.values(S.social || {}).some((u) => /^https?:/.test(u || '')) ? html`<ul class="soc">${Object.entries(S.social).filter(([, u]) => /^https?:/.test(u || '')).map(([k, u]) => html`<li><a href="${u}" rel="noopener me" target="_blank" aria-label="${k}" title="${k}">${socIcon(k)}</a></li>`)}</ul>` : ''}
    </div></div>
  <div class="ftr__base"><span>© ${new Date().getFullYear()} ${c.t(S.brand?.name)}. ${c.ui.rights}</span>${S.brand?.cr ? html`<span>${c.ui.cr}: <bdi>${S.brand.cr}</bdi></span>` : ''}</div>
</div></footer>
<script src="/js/site.js?v=${raw(process.env.ASSET_V || '1')}" defer></script>
</body></html>`;
}
