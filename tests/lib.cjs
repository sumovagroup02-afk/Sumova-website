// tiny test helpers: process boot, cookie-jar client, assertions, reporting
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const results = [];
let current = '';
exports.group = (name) => { current = name; console.log('\n▌ ' + name); };
exports.test = async (name, fn) => {
  const t0 = Date.now();
  try { await fn(); results.push({ group: current, name, ok: true }); console.log('  ✓ ' + name); }
  catch (e) { results.push({ group: current, name, ok: false, err: e.message }); console.log('  ✗ ' + name + '\n      → ' + e.message.split('\n')[0]); }
};
exports.results = results;
const assert = (c, msg) => { if (!c) throw new Error(msg || 'assertion failed'); };
exports.assert = assert;
exports.eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg || 'not equal'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };
exports.has = (s, sub, msg) => { if (!String(s).includes(sub)) throw new Error(`${msg || 'missing'}: «${sub}»`); };
exports.lacks = (s, sub, msg) => { if (String(s).includes(sub)) throw new Error(`${msg || 'should not contain'}: «${sub}»`); };

exports.boot = async ({ port = 3199, env = {} } = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sumova-test-'));
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PASSWORD: 'Test-Pass-12345', ADMIN_EMAIL: 'owner@test.local', TRUST_PROXY: '1', NODE_NO_WARNINGS: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d)); proc.stderr.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(base + '/healthz'); if (r.ok) return { base, dir, proc, log: () => log, stop: () => proc.kill() }; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  proc.kill();
  throw new Error('server did not start:\n' + log);
};

// ── independent RFC 6238 TOTP for tests (does not reuse server code)
const crypto = require('node:crypto');
const b32d = (s) => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, v = 0; const o = []; for (const ch of s.replace(/[^A-Z2-7]/g, '')) { v = (v << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); };
const totp = (secret, step) => { const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(step)); const h = crypto.createHmac('sha1', b32d(secret)).update(m).digest(); const o = h[19] & 15; return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0'); };
exports.totp = totp;
exports.secrets = new Map(); exports.recovery = new Map();
const lastStep = new Map();
// a fresh, never-used code for this user (the server refuses replays); waits for the next 30 s window if needed
exports.nextCode = async (email) => {
  const sec = exports.secrets.get(email); if (!sec) throw new Error('no TOTP secret for ' + email);
  for (;;) {
    const now = Math.floor(Date.now() / 30000), last = lastStep.get(email) || 0;
    for (const s of [now, now + 1]) if (s > last) { lastStep.set(email, s); return totp(sec, s); }
    await new Promise((r) => setTimeout(r, 1000));
  }
};
exports.markUsed = (email, code) => { const sec = exports.secrets.get(email), now = Math.floor(Date.now() / 30000); for (const s of [now - 1, now, now + 1]) if (totp(sec, s) === code) lastStep.set(email, Math.max(lastStep.get(email) || 0, s)); };
// reads a zip (e.g. .xlsx) via its central directory → Map(name → Buffer)
exports.unzip = (buf) => {
  const zlib = require('node:zlib'); const out = new Map();
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not a zip');
  let p = buf.readUInt32LE(e + 16);
  for (let i = 0; i < buf.readUInt16LE(e + 10); i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString();
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28), data = buf.slice(start, start + size);
    out.set(name, method === 8 ? zlib.inflateRawSync(data) : data);
    p += 46 + nlen + xlen + clen;
  }
  return out;
};
// sheet XML → rows of cell values (inline strings / numbers)
exports.sheetRows = (xml) => [...xml.matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)].map((r) => [...r[1].matchAll(/<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
  const v = /<v>([^<]*)<\/v>/.exec(c[2] || ''), t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(c[2] || '');
  return v ? Number(v[1]) : t ? t[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&') : null;
}));
const hidden = (text, name) => new RegExp(`name="${name}" value="([^"]+)"`).exec(text)?.[1];

exports.Client = class Client {
  constructor(base) { this.base = base; this.jar = new Map(); this.rotate(); }
  rotate() { this.ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`; }
  _cookies() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
  async req(method, url, { form, multipart, json, headers = {}, redirect = 'manual' } = {}) {
    const h = { 'x-forwarded-for': this.ip, ...headers }; let body;
    if (this.jar.size) h.cookie = this._cookies();
    if (form) { body = new URLSearchParams(form).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
    else if (multipart) body = multipart;
    else if (json) { body = JSON.stringify(json); h['content-type'] = 'application/json'; }
    const r = await fetch(this.base + url, { method, headers: h, body, redirect });
    for (const c of r.headers.getSetCookie?.() || []) {
      const [kv] = c.split(';'); const i = kv.indexOf('=');
      const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
      if (/Max-Age=0/i.test(c)) this.jar.delete(k); else this.jar.set(k, v);
    }
    const text = await r.text();
    return { status: r.status, headers: r.headers, text, loc: r.headers.get('location') };
  }
  get(url, o) { return this.req('GET', url, o); }
  post(url, form, o = {}) { return this.req('POST', url, { form, ...o }); }
  async login(email, password) {
    const g = await this.get('/admin/login');
    const lt = /name="lt" value="([^"]+)"/.exec(g.text)?.[1];
    return this.post('/admin/login', { lt, email, password });
  }
  // password + second step: enters a code if 2FA is on, or enrols (storing the secret) if it is mandatory
  async fullLogin(email, password) {
    const r = await this.login(email, password);
    if (r.loc === '/admin/login/2fa') return this.enterCode(email, await exports.nextCode(email));
    if (r.loc === '/admin/account/2fa') return this.enrol(email);
    return r;
  }
  async enterCode(email, code) {
    const g = await this.get('/admin/login/2fa');
    return this.post('/admin/login/2fa', { _csrf: hidden(g.text, '_csrf'), code });
  }
  async enrol(email) {
    const g = await this.get('/admin/account/2fa');
    const secret = /data-secret>([^<]+)</.exec(g.text)[1].replace(/\s/g, '');
    exports.secrets.set(email, secret);
    const r = await this.post('/admin/account/2fa/enable', { _csrf: hidden(g.text, '_csrf'), code: await exports.nextCode(email) });
    exports.recovery.set(email, [...r.text.matchAll(/<li><code>([a-z0-9]{5}-[a-z0-9]{5})<\/code><\/li>/g)].map((m) => m[1]));
    return r;
  }
  async csrf(url = '/admin') { const r = await this.get(url); return /data-csrf="([^"]+)"/.exec(r.text)?.[1]; }
};

exports.finish = (extra = {}) => {
  const pass = results.filter((r) => r.ok).length, fail = results.filter((r) => !r.ok);
  console.log(`\n══════ ${pass}/${results.length} passed${fail.length ? `, ${fail.length} FAILED` : ''} ══════`);
  fail.forEach((f) => console.log(` ✗ [${f.group}] ${f.name}\n     ${f.err}`));
  fs.writeFileSync(path.resolve(__dirname, 'report.json'), JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results, ...extra }, null, 2));
  return fail.length;
};
