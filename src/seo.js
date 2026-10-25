import { all, J, tr, hasLang, getSettings } from './db.js';
import { getMedia } from './media.js';
import { esc } from './html.js';

const T = (v, l = 'ar') => tr(v, l);

// pull the first media id / heading / description out of a page's blocks
export function pageFacts(page) {
  let og = null, h1 = '', lede = '';
  for (const b of page.blocks || []) {
    const d = b.data || {};
    if (!og && d.media) og = d.media;
    if (!og && b.type === 'strips') og = (d.items || []).find((i) => i.media)?.media || null;
    if (!h1 && b.type === 'page_head') { h1 = d.title; lede ||= d.lede; }
    if (!h1 && b.type === 'hero') { h1 = d.headline; lede ||= d.sub; }
    if (!lede && (b.type === 'richtext' || b.type === 'text_image')) lede = d.body;
  }
  return { og, h1, lede };
}

export function resolveSeo(c, page, fallbackDesc = '') {
  const S = c.S, s = page.seo || {}, f = pageFacts(page);
  const brand = c.t(S.brand?.name) || 'SUMOVA';
  const base = c.t(s.title) || c.t(page.title);
  const title = page.slug === 'home' && c.t(s.title) ? c.t(s.title) : (base.includes(brand) ? base : `${base} | ${brand}`);
  let desc = c.t(s.desc) || String(c.t(f.lede) || fallbackDesc || c.t(S.seo?.desc) || '').replace(/\s+/g, ' ').trim();
  if (desc.length > 160) desc = desc.slice(0, 157).replace(/\s+\S*$/, '') + '…';
  return { title, desc, og: s.og || f.og || S.seo?.og || null, noindex: !!s.noindex || (c.lang === 'en' && !hasLang(page.title, 'en')),
    h1: String(c.t(f.h1)).split('\n')[0], enOk: hasLang(page.title, 'en') };
}

export function sitemapXml(siteUrl) {
  const urls = [];
  const add = (path, hasEn, lastmod) => {
    const ar = siteUrl + path, en = siteUrl + (path === '/' ? '/en' : '/en' + path);
    urls.push(`<url><loc>${esc(ar)}</loc>${lastmod ? `<lastmod>${lastmod.slice(0, 10)}</lastmod>` : ''}` +
      (hasEn ? `<xhtml:link rel="alternate" hreflang="ar" href="${esc(ar)}"/><xhtml:link rel="alternate" hreflang="en" href="${esc(en)}"/><xhtml:link rel="alternate" hreflang="x-default" href="${esc(ar)}"/>` : '') + '</url>');
    if (hasEn) urls.push(`<url><loc>${esc(en)}</loc>${lastmod ? `<lastmod>${lastmod.slice(0, 10)}</lastmod>` : ''}<xhtml:link rel="alternate" hreflang="ar" href="${esc(ar)}"/><xhtml:link rel="alternate" hreflang="en" href="${esc(en)}"/></url>`);
  };
  for (const p of all('SELECT slug,title,seo,updated_at FROM pages WHERE published=1 ORDER BY sort,id')) {
    const seo = J(p.seo);
    if (seo.noindex) continue;
    add(p.slug === 'home' ? '/' : '/' + p.slug, hasLang(J(p.title), 'en'), p.updated_at);
  }
  for (const p of all('SELECT slug,name,updated_at FROM products WHERE published=1 ORDER BY id'))
    add('/products/' + p.slug, hasLang(J(p.name), 'en'), p.updated_at);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.join('')}</urlset>`;
}

export const robotsTxt = (siteUrl) => `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /track\nDisallow: /request\nDisallow: /contact-send\nDisallow: /api/\n\nSitemap: ${siteUrl}/sitemap.xml\n`;

// ───────── audit used by the dashboard
export function auditSeo() {
  const issues = [];
  const titles = new Map();
  const push = (level, where, url, msg) => issues.push({ level, where, url, msg });
  const rows = all('SELECT id,slug,title,seo,blocks,published FROM pages ORDER BY sort,id').map((p) => ({ ...p, title: J(p.title), seo: J(p.seo), blocks: J(p.blocks, []) }));
  for (const p of rows) {
    if (!p.published) continue;
    const where = T(p.title) || p.slug, url = `/admin/pages/${p.id}`;
    const st = T(p.seo.title) || T(p.title), sd = T(p.seo.desc);
    if (!T(p.seo.title)) push('info', where, url, 'لا يوجد عنوان SEO مخصص؛ يُستخدم عنوان الصفحة.');
    if (st.length < 12) push('bad', where, url, `عنوان الصفحة قصير جدًا (${st.length} حرفًا).`);
    if (st.length > 65) push('warn', where, url, `عنوان SEO طويل (${st.length} حرفًا). الأفضل أقل من 65.`);
    if (!sd) push('bad', where, url, 'لا يوجد وصف (Meta description).');
    else if (sd.length < 70) push('warn', where, url, `الوصف قصير (${sd.length} حرفًا). الأفضل بين 70 و160.`);
    else if (sd.length > 165) push('warn', where, url, `الوصف طويل (${sd.length} حرفًا). الأفضل أقل من 160.`);
    const k = st.trim();
    if (titles.has(k)) push('bad', where, url, `عنوان مكرر مع صفحة «${titles.get(k)}».`); else titles.set(k, where);
    const f = pageFacts(p);
    if (p.slug !== 'home' && !T(f.h1)) push('bad', where, url, 'لا يوجد عنوان رئيسي H1 (أضف «رأس الصفحة»).');
    if (!(p.seo.og || f.og)) push('warn', where, url, 'لا توجد صورة للمشاركة على الشبكات.');
    if (p.seo.noindex) push('info', where, url, 'الصفحة مستثناة من محركات البحث (noindex).');
    if (!hasLang(p.title, 'en')) push('info', where, url, 'لا توجد نسخة إنجليزية لهذه الصفحة.');
    const seen = new Set();
    const walk = (o) => { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) return o.forEach(walk); if (o.media && typeof o.media === 'number') seen.add(o.media); Object.values(o).forEach(walk); };
    p.blocks.forEach((b) => walk(b.data));
    for (const id of seen) { const m = getMedia(id); if (m && !T(J(m.alt))) push('warn', where, `/admin/media/${id}`, `صورة بدون نص بديل (alt) – رقم ${id}.`); }
  }
  for (const m of all('SELECT id,orig_name,alt FROM media')) {
    if (!T(J(m.alt))) push('info', 'مكتبة الوسائط', `/admin/media/${m.id}`, `الصورة «${m.orig_name || m.id}» بلا نص بديل.`);
  }
  return issues;
}
