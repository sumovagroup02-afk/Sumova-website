import { html, raw } from '../html.js';
import { can, ROLES, parseCookies, setCookie } from '../auth.js';
import { one } from '../db.js';

const NAV = [
  { href: '/admin', label: 'نظرة عامة', icon: '◧', perm: null, exact: true },
  { href: '/admin/requests', label: 'الطلبات', icon: '✉', perm: 'requests', badge: true },
  { href: '/admin/pages', label: 'الصفحات', icon: '▤', perm: 'pages' },
  { href: '/admin/media', label: 'الصور', icon: '▣', perm: 'media' },
  { href: '/admin/products', label: 'المنتجات', icon: '❖', perm: 'products' },
  { href: '/admin/seo', label: 'تحسين محركات البحث', icon: '⌕', perm: 'seo' },
  { href: '/admin/settings', label: 'الإعدادات', icon: '⚙', perm: 'settings' },
  { href: '/admin/users', label: 'المستخدمون', icon: '☺', perm: 'users' },
  { href: '/admin/integrations', label: 'الربط والـ API', icon: '⇄', perm: 'integrations' },
  { href: '/admin/audit', label: 'سجل التغييرات', icon: '☰', perm: 'audit' },
];

export function flash(res, type, msg) { setCookie(res, 'flash', JSON.stringify({ type, msg }), { maxAge: 15000, path: '/admin' }); }
function takeFlash(req, res) {
  const c = parseCookies(req).flash;
  if (!c) return null;
  setCookie(res, 'flash', '', { maxAge: 0, path: '/admin' });
  try { return JSON.parse(c); } catch { return null; }
}

export function shell(req, res, { title, body, active, wide = false, head = '' }) {
  const u = req.user;
  const f = takeFlash(req, res);
  const unseen = can(u, 'requests') ? one("SELECT COUNT(*) n FROM requests WHERE seen_at IS NULL").n : 0;
  const nav = NAV.filter((n) => !n.perm || can(u, n.perm));
  const out = html`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${title} – لوحة التحكم</title>
<link rel="icon" href="/brand/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/css/site.css"><link rel="stylesheet" href="/css/admin.css?v=1">${head}</head>
<body class="adm" data-csrf="${req.csrf}" data-unseen="${unseen}">
<a class="skip" href="#main">تخطَّ إلى المحتوى</a>
<aside class="side"><a class="side__logo" href="/admin"><img src="/brand/logo-ar-onink.svg" alt="سوموفا" width="150" height="42"></a>
  <nav aria-label="القائمة الرئيسية">${nav.map((n) => html`<a href="${n.href}" ${raw((n.exact ? active === n.href : active?.startsWith(n.href)) ? 'aria-current="page"' : '')}><span aria-hidden="true">${n.icon}</span>${n.label}${n.badge ? html`<b class="badge" data-badge ${raw(unseen ? '' : 'hidden')}>${unseen}</b>` : ''}</a>`)}</nav>
  <div class="side__foot"><div class="who"><b>${u.name}</b><small>${ROLES[u.role]?.label}</small></div>
    <a href="/" target="_blank" rel="noopener">عرض الموقع ↗</a><a href="/admin/account">حسابي</a><a href="/admin/account/sessions">جلساتي</a>
    <form method="post" action="/admin/logout"><input type="hidden" name="_csrf" value="${req.csrf}"><button class="linkbtn plain">تسجيل الخروج</button></form></div></aside>
<main id="main" class="main ${wide ? 'wide' : ''}">
  ${f ? html`<div class="toast ${f.type}" role="status">${f.msg}</div>` : ''}
  ${body}
</main>
<script src="/js/admin.js?v=1" defer></script>
</body></html>`;
  res.type('html').send(out.toString());
}

export const csrf = (req) => html`<input type="hidden" name="_csrf" value="${req.csrf}">`;

// ── form field helpers (all values escaped)
export const fld = (name, label, value = '', { type = 'text', hint = '', req = false, dir, attrs = '', id } = {}) => html`<div class="f">
  <label for="${id || name}">${label}${req ? html`<i title="مطلوب"> *</i>` : ''}</label>
  <input id="${id || name}" name="${name}" type="${type}" value="${value ?? ''}" ${raw(req ? 'required' : '')} ${raw(dir ? `dir="${dir}"` : '')} ${raw(attrs)}>${hint ? html`<small>${hint}</small>` : ''}</div>`;
export const area = (name, label, value = '', { rows = 4, hint = '', dir, attrs = '' } = {}) => html`<div class="f"><label for="${name}">${label}</label>
  <textarea id="${name}" name="${name}" rows="${rows}" ${raw(dir ? `dir="${dir}"` : '')} ${raw(attrs)}>${value ?? ''}</textarea>${hint ? html`<small>${hint}</small>` : ''}</div>`;
export const check = (name, label, on) => html`<label class="chk"><input type="checkbox" name="${name}" value="1" ${raw(on ? 'checked' : '')}> <span>${label}</span></label>`;
export const select = (name, label, opts, value) => html`<div class="f"><label for="${name}">${label}</label><select id="${name}" name="${name}">${opts.map(([v, l]) => html`<option value="${v}" ${raw(String(v) === String(value) ? 'selected' : '')}>${l}</option>`)}</select></div>`;

// bilingual pair: name_ar / name_en
export const i18n = (name, label, v = {}, { area: isArea = false, rows = 3, hint = '', counter } = {}) => html`<div class="f i18n"><span class="lbl">${label}</span>
  <div class="pair"><div><label for="${name}_ar">عربي</label>${isArea ? html`<textarea id="${name}_ar" name="${name}_ar" rows="${rows}" dir="rtl" ${raw(counter ? `data-count="${counter}"` : '')}>${v?.ar ?? ''}</textarea>` : html`<input id="${name}_ar" name="${name}_ar" value="${v?.ar ?? ''}" dir="rtl" ${raw(counter ? `data-count="${counter}"` : '')}>`}</div>
  <div><label for="${name}_en">English</label>${isArea ? html`<textarea id="${name}_en" name="${name}_en" rows="${rows}" dir="ltr" ${raw(counter ? `data-count="${counter}"` : '')}>${v?.en ?? ''}</textarea>` : html`<input id="${name}_en" name="${name}_en" value="${v?.en ?? ''}" dir="ltr" ${raw(counter ? `data-count="${counter}"` : '')}>`}</div></div>${hint ? html`<small>${hint}</small>` : ''}</div>`;
export const readI18n = (b, name, max = 4000) => ({ ar: String(b[`${name}_ar`] ?? '').trim().slice(0, max), en: String(b[`${name}_en`] ?? '').trim().slice(0, max) });

export const fmtDate = (s) => { if (!s) return ''; const d = new Date(s.replace(' ', 'T') + 'Z'); return isNaN(d) ? s : d.toLocaleString('ar-SA-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh' }); };
export const pageHead = (title, actions = '') => html`<div class="phd"><h1>${title}</h1><div class="acts">${actions}</div></div>`;
export const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9؀-ۿ]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
