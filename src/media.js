import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { one, all, run, J, tr, UPLOAD_DIR } from './db.js';
import { html, raw } from './html.js';

const WIDTHS = [480, 960, 1600, 2400];
sharp.cache(false);

const rows = new Map();
export function getMedia(id) {
  if (!id) return null;
  if (!rows.has(id)) rows.set(id, one('SELECT * FROM media WHERE id=?', id) || null);
  return rows.get(id);
}
export const dropMediaCache = (id) => (id ? rows.delete(id) : rows.clear());

const fileFor = (id, rev, w) => `m${id}-r${rev}-${w}.webp`;
const ogFor = (id, rev) => `m${id}-r${rev}-og.jpg`;

function widthsFor(origW) {
  const ws = WIDTHS.filter((w) => w < origW);
  ws.push(Math.min(origW, 2400));
  return [...new Set(ws)];
}

async function writeVariants(id, rev, buf) {
  const base = sharp(buf, { failOn: 'error' }).rotate();
  const meta = await base.metadata();
  if (!['jpeg', 'png', 'webp', 'gif', 'avif', 'heif', 'tiff'].includes(meta.format)) throw new Error('نوع الصورة غير مدعوم. ارفع JPG أو PNG أو WebP.');
  const w0 = Math.min(meta.width || 2400, 2400);
  const resized = await sharp(buf).rotate().resize({ width: w0, withoutEnlargement: true }).toBuffer({ resolveWithObject: true });
  const W = resized.info.width, H = resized.info.height;
  for (const w of widthsFor(W)) {
    await sharp(resized.data).resize({ width: w, withoutEnlargement: true }).webp({ quality: w <= 480 ? 74 : 80 }).toFile(path.join(UPLOAD_DIR, fileFor(id, rev, w)));
  }
  await sharp(resized.data).resize(1200, 630, { fit: 'cover', position: 'attention' }).jpeg({ quality: 82 }).toFile(path.join(UPLOAD_DIR, ogFor(id, rev)));
  return { width: W, height: H, widths: widthsFor(W) };
}

function removeFiles(id, rev) {
  for (const f of fs.readdirSync(UPLOAD_DIR)) if (f.startsWith(`m${id}-r${rev}-`)) fs.rmSync(path.join(UPLOAD_DIR, f), { force: true });
}

export async function addMedia(buf, origName, alt = {}) {
  const r = run("INSERT INTO media(filename,orig_name,mime,bytes,alt) VALUES('',?,?,?,?)", origName, 'image/webp', buf.length, JSON.stringify(alt));
  const id = Number(r.lastInsertRowid);
  try {
    const v = await writeVariants(id, 1, buf);
    run("UPDATE media SET filename=?, width=?, height=? WHERE id=?", `m${id}`, v.width, v.height, id);
  } catch (e) {
    run('DELETE FROM media WHERE id=?', id);
    removeFiles(id, 1);
    throw e;
  }
  dropMediaCache(id);
  return id;
}

// Replace the picture, keep the id → every place that uses it updates automatically.
export async function replaceMedia(id, buf, origName) {
  const m = one('SELECT * FROM media WHERE id=?', id);
  if (!m) throw new Error('الصورة غير موجودة');
  const rev = m.rev + 1;
  const v = await writeVariants(id, rev, buf);
  run("UPDATE media SET rev=?, width=?, height=?, bytes=?, orig_name=?, updated_at=datetime('now') WHERE id=?", rev, v.width, v.height, buf.length, origName, id);
  removeFiles(id, m.rev);
  dropMediaCache(id);
}
export function deleteMedia(id) {
  const m = one('SELECT * FROM media WHERE id=?', id);
  if (!m) return;
  removeFiles(id, m.rev);
  run('DELETE FROM media WHERE id=?', id);
  dropMediaCache(id);
}

export function mediaUsage(id) {
  const uses = [];
  const needle = new RegExp(`"(media|image|image_id|og_media|bg)":\\s*${id}(?![0-9])`);
  for (const p of all('SELECT id,slug,title,blocks,seo FROM pages')) if (needle.test(p.blocks) || needle.test(p.seo)) uses.push({ type: 'page', id: p.id, label: tr(J(p.title), 'ar') || p.slug });
  for (const c of all('SELECT id,name FROM categories WHERE image_id=?', id)) uses.push({ type: 'category', id: c.id, label: tr(J(c.name)) });
  for (const p of all('SELECT id,name FROM products WHERE image_id=?', id)) uses.push({ type: 'product', id: p.id, label: tr(J(p.name)) });
  return uses;
}

export const mediaUrl = (id, w = 960) => {
  const m = getMedia(id);
  if (!m) return '';
  const ws = widthsFor(m.width || 960);
  const pick = ws.find((x) => x >= w) || ws[ws.length - 1];
  return `/media/${fileFor(m.id, m.rev, pick)}`;
};
export const ogUrl = (id) => { const m = getMedia(id); return m ? `/media/${ogFor(m.id, m.rev)}` : ''; };

// <img> with srcset, intrinsic size (no layout shift) and required alt text
export function img(id, { lang = 'ar', sizes = '100vw', cls = '', eager = false, alt, fetchpriority } = {}) {
  const m = getMedia(id);
  if (!m) return html``;
  const ws = widthsFor(m.width || 960);
  const srcset = ws.map((w) => `/media/${fileFor(m.id, m.rev, w)} ${w}w`).join(', ');
  const a = alt != null ? alt : tr(J(m.alt), lang);
  return html`<img src="${raw(mediaUrl(id, 960))}" srcset="${srcset}" sizes="${sizes}" width="${m.width}" height="${m.height}" alt="${a}" class="${cls}" loading="${eager ? 'eager' : 'lazy'}" decoding="async" ${raw(fetchpriority ? `fetchpriority="${fetchpriority}"` : '')}>`;
}
