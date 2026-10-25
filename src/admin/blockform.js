// Schema-driven editing forms for page blocks: render <-> read (sanitise) round trip.
import { html, raw } from '../html.js';
import { BLOCKS } from '../blocks.js';
import { getMedia, mediaUrl } from '../media.js';

const nm = (prefix, k, sub) => `${prefix}[${k}]${sub ? `[${sub}]` : ''}`;
const idOf = (s) => s.replace(/[^a-zA-Z0-9]+/g, '_');

function mediaField(prefix, f, v) {
  const m = getMedia(Number(v));
  return html`<div class="f mediafield" data-media><span class="lbl">${f.label}</span>
    <div class="mediabox"><div class="thumb">${m ? html`<img src="${raw(mediaUrl(m.id, 480))}" alt="" width="120" height="80">` : html`<span class="empty">بدون صورة</span>`}</div>
    <div class="mbtns"><input type="hidden" name="${nm(prefix, f.k)}" value="${m ? m.id : ''}">
      <button type="button" class="btn-s" data-pick>اختيار صورة</button><button type="button" class="linkbtn" data-clear ${raw(m ? '' : 'hidden')}>إزالة</button></div></div></div>`;
}

export function fieldHtml(prefix, f, data = {}, depth = 0) {
  const v = data?.[f.k];
  const id = idOf(nm(prefix, f.k));
  switch (f.t) {
    case 'i18n':
    case 'i18n-area': {
      const area = f.t === 'i18n-area';
      const mk = (lng, dir, label) => html`<div><label for="${id}_${lng}">${label}</label>${area
        ? html`<textarea id="${id}_${lng}" name="${nm(prefix, f.k, lng)}" rows="3" dir="${dir}">${v?.[lng] ?? ''}</textarea>`
        : html`<input id="${id}_${lng}" name="${nm(prefix, f.k, lng)}" value="${v?.[lng] ?? ''}" dir="${dir}">`}</div>`;
      return html`<div class="f i18n"><span class="lbl">${f.label}</span><div class="pair">${mk('ar', 'rtl', 'عربي')}${mk('en', 'ltr', 'English')}</div></div>`;
    }
    case 'media': return mediaField(prefix, f, v);
    case 'url': return html`<div class="f"><label for="${id}">${f.label}</label><input id="${id}" name="${nm(prefix, f.k)}" value="${v ?? ''}" dir="ltr" placeholder="/contact أو https://…"></div>`;
    case 'text': return html`<div class="f"><label for="${id}">${f.label}</label><input id="${id}" name="${nm(prefix, f.k)}" value="${v ?? ''}"></div>`;
    case 'select': return html`<div class="f"><label for="${id}">${f.label}</label><select id="${id}" name="${nm(prefix, f.k)}">${f.opts.map(([ov, ol]) => html`<option value="${ov}" ${raw((v ?? f.opts[0][0]) === ov ? 'selected' : '')}>${ol}</option>`)}</select></div>`;
    case 'bool': return html`<label class="chk"><input type="checkbox" name="${nm(prefix, f.k)}" value="1" ${raw(v ? 'checked' : '')}> <span>${f.label}</span></label>`;
    case 'list': {
      const items = Array.isArray(v) ? v : [];
      const row = (it, i) => html`<li class="lrow" data-row><div class="lrow__bar"><b>${f.itemLabel}</b>
          <span><button type="button" class="ico" data-up title="تحريك للأعلى" aria-label="تحريك للأعلى">↑</button><button type="button" class="ico" data-down title="تحريك للأسفل" aria-label="تحريك للأسفل">↓</button><button type="button" class="ico bad" data-del title="حذف" aria-label="حذف">✕</button></span></div>
          <div class="lrow__body">${f.fields.map((sf) => fieldHtml(`${prefix}[${f.k}][${i}]`, sf, it, depth + 1))}</div></li>`;
      return html`<div class="f list" data-list data-max="${f.max || 20}" data-prefix="${prefix}[${f.k}]"><span class="lbl">${f.label}</span>
        <ol class="lrows">${items.map(row)}</ol>
        <template data-tpl>${row({}, '__I__')}</template>
        <button type="button" class="btn-s" data-add>+ إضافة ${f.itemLabel}</button></div>`;
    }
    default: return '';
  }
}

export function blockCard(type, data, idx, bid, open = false) {
  const def = BLOCKS[type];
  if (!def) return html`<li class="blk" data-block><input type="hidden" name="blocks[${idx}][type]" value="${type}"><input type="hidden" name="blocks[${idx}][id]" value="${bid}"><p>نوع غير معروف: ${type}</p></li>`;
  const p = `blocks[${idx}][data]`;
  return html`<li class="blk" data-block>
    <input type="hidden" name="blocks[${idx}][type]" value="${type}"><input type="hidden" name="blocks[${idx}][id]" value="${bid}">
    <div class="blk__tools"><button type="button" class="ico" data-bup title="تحريك للأعلى" aria-label="تحريك القسم للأعلى">↑</button><button type="button" class="ico" data-bdown title="تحريك للأسفل" aria-label="تحريك القسم للأسفل">↓</button><button type="button" class="ico bad" data-bdel title="حذف القسم" aria-label="حذف القسم">✕</button></div>
    <details ${raw(open ? 'open' : '')}><summary><span class="blk__name">${def.label}</span></summary>
      <div class="blk__body"><p class="hint">${def.desc}</p>${def.fields.map((f) => fieldHtml(p, f, data || {}))}</div></details></li>`;
}

export function blockTemplates() {
  return Object.keys(BLOCKS).map((t) => html`<template data-btpl="${t}">${blockCard(t, {}, '__B__', '__ID__', true)}</template>`);
}

// ───── reading (sanitising) what the browser posted
const arr = (o) => (Array.isArray(o) ? o : o && typeof o === 'object' ? Object.keys(o).filter((k) => /^\d+$/.test(k)).sort((a, b) => a - b).map((k) => o[k]) : []);
const str = (v, n = 4000) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n) : '');
export function cleanUrl(u) {
  u = str(u, 500);
  if (!u) return '';
  if (/^(\/(?!\/)|#|https?:\/\/|mailto:|tel:)/i.test(u)) return u;
  return '';
}
function readField(f, raw0) {
  switch (f.t) {
    case 'i18n': case 'i18n-area': return { ar: str(raw0?.ar), en: str(raw0?.en) };
    case 'media': { const n = parseInt(raw0, 10); return Number.isFinite(n) && n > 0 ? n : null; }
    case 'url': return cleanUrl(raw0);
    case 'text': return str(raw0, 300);
    case 'select': return f.opts.some(([v]) => v === raw0) ? raw0 : f.opts[0][0];
    case 'bool': return raw0 === '1';
    case 'list': return arr(raw0).slice(0, f.max || 20).map((it) => readFields(f.fields, it));
    default: return null;
  }
}
const readFields = (fields, data) => Object.fromEntries(fields.map((f) => [f.k, readField(f, data?.[f.k])]));

export function readBlocks(body) {
  const out = [];
  for (const b of arr(body.blocks).slice(0, 40)) {
    const def = BLOCKS[b?.type];
    if (!def) continue;
    out.push({ id: str(b.id, 20).replace(/[^a-z0-9_]/gi, '') || Math.random().toString(36).slice(2, 9), type: b.type, data: readFields(def.fields, b.data) });
  }
  return out;
}
