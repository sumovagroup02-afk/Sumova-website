import crypto from 'node:crypto';
import { one, run, all, audit } from './db.js';

const SESSION_TTL = 1000 * 60 * 60 * 12; // 12h
const SECURE = process.env.COOKIE_SECURE === '1';

export const ROLES = {
  owner: { label: 'مالك', can: ['pages', 'media', 'products', 'seo', 'requests', 'settings', 'users', 'audit', 'integrations'] },
  admin: { label: 'مدير', can: ['pages', 'media', 'products', 'seo', 'requests', 'settings', 'audit'] },
  editor: { label: 'محرر محتوى', can: ['pages', 'media', 'products', 'seo'] },
  sales: { label: 'مبيعات', can: ['requests'] },
};
export const can = (user, perm) => !!user && (ROLES[user.role]?.can || []).includes(perm);

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const h = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const b = Buffer.from(hashHex, 'hex');
  return b.length === h.length && crypto.timingSafeEqual(b, h);
}
export const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const rand = (n = 32) => crypto.randomBytes(n).toString('base64url');

export function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function setCookie(res, name, value, { maxAge, path = '/' } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=Lax`;
  if (maxAge != null) c += `; Max-Age=${Math.floor(maxAge / 1000)}`;
  if (SECURE) c += '; Secure';
  res.append('Set-Cookie', c);
}

export function createSession(res, user, req) {
  const token = rand(32);
  const csrf = rand(24);
  run('INSERT INTO sessions(token_hash,user_id,csrf,expires_at,ip,ua) VALUES(?,?,?,?,?,?)',
    sha(token), user.id, csrf, Date.now() + SESSION_TTL, req.ip, String(req.headers['user-agent'] || '').slice(0, 200));
  setCookie(res, 'sid', token, { maxAge: SESSION_TTL, path: '/admin' });
  run("UPDATE users SET last_login=datetime('now') WHERE id=?", user.id);
}
export function destroySession(req, res) {
  const t = parseCookies(req).sid;
  if (t) run('DELETE FROM sessions WHERE token_hash=?', sha(t));
  setCookie(res, 'sid', '', { maxAge: 0, path: '/admin' });
}

// Loads req.user / req.csrf if a valid session exists
export function loadUser(req, _res, next) {
  const t = parseCookies(req).sid;
  if (t) {
    const row = one(`SELECT s.csrf, s.expires_at, u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`, sha(t));
    if (row && row.expires_at > Date.now() && row.active) {
      req.user = { id: row.id, email: row.email, name: row.name, role: row.role };
      req.csrf = row.csrf;
    } else if (row) run('DELETE FROM sessions WHERE token_hash=?', sha(t));
  }
  next();
}
export const requireLogin = (req, res, next) => (req.user ? next() : res.redirect('/admin/login'));
export const requirePerm = (perm) => (req, res, next) => {
  if (!req.user) return res.redirect('/admin/login');
  if (!can(req.user, perm)) return res.status(403).send(res.locals.renderForbidden ? res.locals.renderForbidden() : 'غير مصرّح');
  next();
};
export function checkCsrf(req) {
  const sent = req.body?._csrf || req.headers['x-csrf-token'];
  if (!req.csrf || !sent) return false;
  const a = Buffer.from(String(sent)), b = Buffer.from(req.csrf);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function csrfGuard(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  if (req.is('multipart/form-data')) return next(); // checked after multer in the route (see guardAfterUpload)
  if (!checkCsrf(req)) return res.status(403).send('انتهت صلاحية النموذج. أعد تحميل الصفحة وحاول مرة أخرى.');
  next();
}
export const guardAfterUpload = (req, res, next) => (checkCsrf(req) ? next() : res.status(403).send('انتهت صلاحية النموذج. أعد تحميل الصفحة وحاول مرة أخرى.'));

// Login throttling: 8 failures / 15 min per ip+email
const fails = new Map();
export function throttled(key) {
  const f = fails.get(key);
  if (!f) return false;
  if (Date.now() - f.first > 15 * 60 * 1000) { fails.delete(key); return false; }
  return f.n >= 8;
}
export const noteFail = (key) => { const f = fails.get(key); if (!f || Date.now() - f.first > 15 * 60 * 1000) fails.set(key, { n: 1, first: Date.now() }); else f.n++; };
export const clearFails = (key) => fails.delete(key);

// Simple public-form throttle (per ip, N per window)
const hits = new Map();
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  return arr.length > max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 3600e3)) hits.delete(k); }, 600e3).unref();

export function createUser({ email, name, password, role = 'editor' }, by) {
  run('INSERT INTO users(email,name,password_hash,role) VALUES(?,?,?,?)', email.toLowerCase().trim(), name, hashPassword(password), role);
  const u = one('SELECT id FROM users WHERE email=?', email.toLowerCase().trim());
  audit(by, 'create', 'user', u.id, `${email} (${role})`);
  return u.id;
}
export { all };
