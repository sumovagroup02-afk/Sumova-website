// Cloudflare deployment pieces that run outside the browser: backups/restore, file sync, www redirect.
// Uses a folder as the object store (same interface as R2) and the live test server's DATA_DIR.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
const { group, test, assert, eq, has } = require('./lib.cjs');

const imp = (rel) => import(pathToFileURL(path.resolve(__dirname, '..', rel)).href);
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const count = (file, sql) => { const db = new DatabaseSync(file, { readOnly: true }); try { return db.prepare(sql).get().n; } finally { db.close(); } };
const listFiles = (root) => { const out = []; const w = (d, r = '') => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? w(path.join(d, e.name), r + e.name + '/') : out.push(r + e.name); }; w(root); return out.sort(); };

module.exports = async (S) => {
  const { openStore } = await imp('ops/objstore.mjs');
  const data = await imp('ops/data.mjs');
  const { canonicalRedirect } = await imp('cloudflare/src/redirect.js');
  const store = openStore({ OBJ_DIR: tmp('smv-obj-') });

  group('Cloudflare: backups & persistence · النسخ الاحتياطي');
  let key;
  await test('daily backup of the live DATA_DIR: consistent DB copy + uploads + private, stored under backups/', async () => {
    const r = await data.backup(store, S.dir, { date: '2026-10-25' }); key = r.key;
    eq(key, 'backups/sumova-2026-10-25.tar.gz'); assert(r.bytes > 1000, 'backup too small');
    assert(await data.hasBackupFor(store, '2026-10-25'), 'hasBackupFor');
  });
  await test('restore one backup into an empty folder: same pages, requests, users and files as the live site', async () => {
    const to = tmp('smv-restore-');
    eq(await data.restoreBackup(store, 'latest', to), key);
    const live = path.join(S.dir, 'sumova.db'), back = path.join(to, 'sumova.db');
    for (const t of ['pages', 'requests', 'users', 'media', 'settings']) eq(count(back, `SELECT COUNT(*) n FROM ${t}`), count(live, `SELECT COUNT(*) n FROM ${t}`), t);
    eq(count(back, 'SELECT COUNT(*) n FROM users WHERE totp_on=1') > 0, true, '2FA state restored');
    const a = listFiles(path.join(S.dir, 'uploads')), b = listFiles(path.join(to, 'uploads')); assert(a.length > 0, 'no uploads to compare'); eq(JSON.stringify(b), JSON.stringify(a), 'uploads');
    eq(JSON.stringify(listFiles(path.join(to, 'private'))), JSON.stringify(listFiles(path.join(S.dir, 'private'))), 'private files');
  });
  await test('the restored database boots the real site (pages render, owner can still sign in)', async () => {
    const to = tmp('smv-boot-'); await data.restoreBackup(store, key, to);
    const { boot, Client } = require('./lib.cjs');
    const S2 = await boot({ port: 3198, env: { DATA_DIR: to, ADMIN_PASSWORD: '' } });
    try {
      const r = await fetch(S2.base + '/'); eq(r.status, 200); has(await r.text(), 'سوموفا');
      // password + 2FA survive the restore (the browser suite changes the password, so accept either)
      let r2 = await new Client(S2.base).login('owner@test.local', 'New-Pass-1234567');
      if (r2.status === 401) r2 = await new Client(S2.base).login('owner@test.local', 'Test-Pass-12345');
      eq(r2.loc, '/admin/login/2fa');
    } finally { S2.stop(); }
  });
  await test('backups older than 30 days are pruned; the last 30 are kept', async () => {
    for (const d of ['2026-09-20', '2026-09-25', '2026-09-26', '2026-10-01']) await store.put(`backups/sumova-${d}.tar.gz`, Buffer.from('x'));
    eq(await data.prune(store, '2026-10-25'), 2);
    const keys = (await data.listBackups(store)).map((o) => o.key);
    eq(JSON.stringify(keys), JSON.stringify(['backups/sumova-2026-09-26.tar.gz', 'backups/sumova-2026-10-01.tar.gz', 'backups/sumova-2026-10-25.tar.gz']));
  });
  await test('file sync: new, changed and deleted uploads reach the store; a fresh container restores them', async () => {
    const dir = tmp('smv-sync-'), s2 = openStore({ OBJ_DIR: tmp('smv-obj2-') }), known = new Map();
    fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true }); fs.mkdirSync(path.join(dir, 'private', 'quotes'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'uploads', 'a.webp'), 'A'); fs.writeFileSync(path.join(dir, 'private', 'quotes', 'q.pdf'), 'PDF');
    eq(JSON.stringify(await data.syncFiles(s2, dir, known)), JSON.stringify({ up: 2, del: 0 }));
    eq(JSON.stringify(await data.syncFiles(s2, dir, known)), JSON.stringify({ up: 0, del: 0 }), 'idempotent');
    fs.writeFileSync(path.join(dir, 'uploads', 'a.webp'), 'AA'); fs.rmSync(path.join(dir, 'private', 'quotes', 'q.pdf'));
    eq(JSON.stringify(await data.syncFiles(s2, dir, known)), JSON.stringify({ up: 1, del: 1 }));
    const fresh = tmp('smv-fresh-'); eq(await data.restoreFiles(s2, fresh), 1);
    eq(fs.readFileSync(path.join(fresh, 'uploads', 'a.webp'), 'utf8'), 'AA'); assert(!fs.existsSync(path.join(fresh, 'private', 'quotes', 'q.pdf')), 'deleted file came back');
  });

  group('Cloudflare: Worker · التوجيه');
  await test('www.sumova.org → https://sumova.org (301 target keeps path and query); apex untouched', async () => {
    eq(canonicalRedirect('https://www.sumova.org/factory?c=x'), 'https://sumova.org/factory?c=x');
    eq(canonicalRedirect('http://www.sumova.org/'), 'https://sumova.org/');
    eq(canonicalRedirect('https://sumova.org/contact'), null);
  });
  await test('wrangler config: one always-on basic container, both hostnames, cron keep-alive, no secrets in the file', async () => {
    const raw = fs.readFileSync(path.resolve(__dirname, '../cloudflare/wrangler.jsonc'), 'utf8');
    const cfg = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
    eq(cfg.containers[0].max_instances, 1); eq(cfg.containers[0].instance_type, 'basic'); eq(cfg.containers[0].image, '../Dockerfile');
    eq(JSON.stringify(cfg.routes.map((r) => r.pattern)), JSON.stringify(['sumova.org', 'www.sumova.org']));
    eq(cfg.triggers.crons[0], '*/5 * * * *');
    assert(!/PASSWORD"\s*:|SECRET_ACCESS_KEY"\s*:|ACCESS_KEY_ID"\s*:/.test(raw), 'secret value in wrangler.jsonc');
  });
};
