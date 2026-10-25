// Container entrypoint. Without an object store it just runs the site.
// With R2 configured (Cloudflare Containers, whose disk is wiped on every restart):
//   1. restore DATA_DIR: files from R2, database from Litestream (or a chosen backup via RESTORE_BACKUP)
//   2. run the site under `litestream replicate` (database streamed to R2 continuously, 30-day retention)
//   3. keep uploads/private files synced to R2 and take one full backup per day (kept 30 days)
//   4. on SIGTERM: stop the site, flush the last file changes
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { openStore } from './objstore.mjs';
import { restoreFiles, syncFiles, backup, hasBackupFor, restoreBackup } from './data.mjs';

const DATA = process.env.DATA_DIR || '/data';
const DB = process.env.DB_FILE || path.join(DATA, 'sumova.db');
const LS_CONF = process.env.LITESTREAM_CONFIG || '/etc/litestream.yml';
const log = (...a) => console.log('[start]', ...a);
const store = openStore();
fs.mkdirSync(DATA, { recursive: true });

const run = (cmd, args) => new Promise((res, rej) => { const p = spawn(cmd, args, { stdio: 'inherit' }); p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`${cmd} exited ${c}`)))); p.on('error', rej); });

let child;
if (!store) {
  child = spawn(process.execPath, ['server.js'], { stdio: 'inherit' });
} else {
  const wanted = process.env.RESTORE_BACKUP;
  const marker = wanted ? `restored/${wanted}` : null;
  if (wanted && !(await store.get(marker))) {
    log('restoring backup', wanted, '→', await restoreBackup(store, wanted, DATA));
    await store.put(marker, Buffer.from(new Date().toISOString())); // restore once only, even if the variable stays set
  } else {
    log('files restored:', await restoreFiles(store, DATA));
    if (!fs.existsSync(DB)) await run('litestream', ['restore', '-config', LS_CONF, '-if-db-not-exists', '-if-replica-exists', DB]);
  }
  child = spawn('litestream', ['replicate', '-config', LS_CONF, '-exec', `${process.execPath} server.js`], { stdio: 'inherit' });

  const known = new Map();
  let busy = false, again = false;
  const sync = async () => {
    if (busy) { again = true; return; }
    busy = true;
    try { const r = await syncFiles(store, DATA, known); if (r.up || r.del) log('files synced', r); }
    catch (e) { console.error('[start] file sync failed:', e.message); }
    finally { busy = false; if (again) { again = false; sync(); } }
  };
  let t;
  for (const d of ['uploads', 'private']) {
    fs.mkdirSync(path.join(DATA, d), { recursive: true });
    try { fs.watch(path.join(DATA, d), { recursive: true }, () => { clearTimeout(t); t = setTimeout(sync, 2000); }); } catch (e) { console.error('[start] watch:', e.message); }
  }
  setInterval(sync, 60e3).unref();
  sync();

  const daily = async () => {
    try { if (!(await hasBackupFor(store))) log('daily backup', await backup(store, DATA)); }
    catch (e) { console.error('[start] daily backup failed:', e.message); }
  };
  setTimeout(daily, 5 * 60e3).unref(); // let the site settle first
  setInterval(daily, 60 * 60e3).unref();

  process.on('SIGTERM', () => { child.kill('SIGTERM'); });
  process.on('SIGINT', () => { child.kill('SIGINT'); });
  child.on('exit', async (code) => { clearTimeout(t); await sync(); process.exit(code ?? 0); });
}
if (!store) {
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => child.kill(s));
  child.on('exit', (code) => process.exit(code ?? 0));
}
