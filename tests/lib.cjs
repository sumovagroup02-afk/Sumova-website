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
  async csrf(url = '/admin') { const r = await this.get(url); return /data-csrf="([^"]+)"/.exec(r.text)?.[1]; }
};

exports.finish = (extra = {}) => {
  const pass = results.filter((r) => r.ok).length, fail = results.filter((r) => !r.ok);
  console.log(`\n══════ ${pass}/${results.length} passed${fail.length ? `, ${fail.length} FAILED` : ''} ══════`);
  fail.forEach((f) => console.log(` ✗ [${f.group}] ${f.name}\n     ${f.err}`));
  fs.writeFileSync(path.resolve(__dirname, 'report.json'), JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results, ...extra }, null, 2));
  return fail.length;
};
