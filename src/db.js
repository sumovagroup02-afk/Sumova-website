import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const PRIVATE_DIR = path.join(DATA_DIR, 'private'); // quote PDFs & customer files – never served statically
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(PRIVATE_DIR, { recursive: true });

const file = process.env.DB_FILE || path.join(DATA_DIR, 'sumova.db');
export const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'editor',
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), last_login TEXT
);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL, expires_at INTEGER NOT NULL, ip TEXT, ua TEXT
);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pages(
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, seo TEXT NOT NULL DEFAULT '{}',
  blocks TEXT NOT NULL DEFAULT '[]', published INTEGER NOT NULL DEFAULT 1, show_in_nav INTEGER NOT NULL DEFAULT 0,
  nav_label TEXT NOT NULL DEFAULT '{}', sort INTEGER NOT NULL DEFAULT 0, kind TEXT NOT NULL DEFAULT 'page',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS media(
  id INTEGER PRIMARY KEY, filename TEXT NOT NULL, orig_name TEXT, mime TEXT, width INTEGER, height INTEGER,
  bytes INTEGER, alt TEXT NOT NULL DEFAULT '{}', rev INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS categories(
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, descr TEXT NOT NULL DEFAULT '{}',
  image_id INTEGER REFERENCES media(id) ON DELETE SET NULL, sort INTEGER NOT NULL DEFAULT 0, published INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY, category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '{}', body TEXT NOT NULL DEFAULT '{}',
  image_id INTEGER REFERENCES media(id) ON DELETE SET NULL, options TEXT NOT NULL DEFAULT '[]', sku TEXT,
  seo TEXT NOT NULL DEFAULT '{}', sort INTEGER NOT NULL DEFAULT 0, published INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS requests(
  id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, kind TEXT NOT NULL DEFAULT 'quote',
  name TEXT NOT NULL, org TEXT, phone TEXT NOT NULL, email TEXT, message TEXT,
  items TEXT NOT NULL DEFAULT '[]', extra TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'new',
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  quote_file TEXT, quote_name TEXT, quote_sent_at TEXT, decision TEXT, decision_at TEXT, files TEXT NOT NULL DEFAULT '[]',
  seen_at TEXT, ip TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS request_events(
  id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  at TEXT NOT NULL DEFAULT (datetime('now')), actor TEXT NOT NULL, type TEXT NOT NULL, note TEXT
);
CREATE TABLE IF NOT EXISTS audit_log(
  id INTEGER PRIMARY KEY, at TEXT NOT NULL DEFAULT (datetime('now')), user_id INTEGER, user_name TEXT,
  action TEXT NOT NULL, entity TEXT, entity_id TEXT, detail TEXT
);
CREATE TABLE IF NOT EXISTS redirects(
  id INTEGER PRIMARY KEY, from_path TEXT UNIQUE NOT NULL, to_path TEXT NOT NULL, code INTEGER NOT NULL DEFAULT 301, hits INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS api_keys(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), last_used TEXT
);
`);

const cache = new Map();
const stmt = (sql) => { let s = cache.get(sql); if (!s) { s = db.prepare(sql); cache.set(sql, s); } return s; };
export const one = (sql, ...p) => stmt(sql).get(...p);
export const all = (sql, ...p) => stmt(sql).all(...p);
export const run = (sql, ...p) => stmt(sql).run(...p);
export const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

export const J = (s, d = {}) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

// ---- settings
let settingsCache = null;
export function getSettings() {
  if (!settingsCache) {
    settingsCache = {};
    for (const r of all('SELECT key,value FROM settings')) settingsCache[r.key] = J(r.value, null);
  }
  return settingsCache;
}
export function setSetting(key, value) {
  run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value));
  settingsCache = null;
}

// ---- i18n helper: value is {ar, en}; falls back to the other language
export function tr(v, lang = 'ar') {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  const primary = v[lang];
  if (primary != null && String(primary).trim() !== '') return primary;
  const other = v[lang === 'ar' ? 'en' : 'ar'];
  return other ?? '';
}
export const hasLang = (v, lang) => !!(v && typeof v === 'object' && String(v[lang] ?? '').trim());

export function audit(user, action, entity, entityId, detail) {
  run('INSERT INTO audit_log(user_id,user_name,action,entity,entity_id,detail) VALUES(?,?,?,?,?,?)',
    user?.id ?? null, user?.name ?? 'system', action, entity ?? null, entityId == null ? null : String(entityId), detail ? String(detail).slice(0, 500) : null);
}
