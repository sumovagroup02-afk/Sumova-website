// DATA_DIR persistence on an object store: file sync (uploads + private), daily backups (30 days), restore.
// CLI:  node ops/data.mjs backup | list | restore <key|latest> <targetDir>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from './objstore.mjs';

export const KEEP_DAYS = 30;
const DIRS = ['uploads', 'private']; // the database itself is streamed separately by Litestream
const dbFile = (dataDir) => process.env.DB_FILE || path.join(dataDir, 'sumova.db');
const riyadhDate = (d = new Date()) => new Date(d.getTime() + 3 * 3600e3).toISOString().slice(0, 10);

function walk(root, rel = '') {
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? walk(root, r) : [{ rel: r, size: fs.statSync(path.join(root, r)).size, mtime: fs.statSync(path.join(root, r)).mtimeMs }];
  });
}

// ── files: local DATA_DIR/{uploads,private} ⇄ store files/{uploads,private}
export async function restoreFiles(store, dataDir) {
  let n = 0;
  for (const o of await store.list('files/')) {
    const local = path.join(dataDir, ...o.key.slice('files/'.length).split('/'));
    if (fs.existsSync(local) && fs.statSync(local).size === o.size) continue;
    fs.mkdirSync(path.dirname(local), { recursive: true });
    fs.writeFileSync(local, await store.get(o.key)); n++;
  }
  return n;
}

// Uploads new/changed files and removes deleted ones. `known` (Map rel→"size:mtime") is kept between calls.
export async function syncFiles(store, dataDir, known) {
  if (!known.size) for (const o of await store.list('files/')) known.set(o.key.slice(6), `${o.size}:remote`);
  const seen = new Set(); let up = 0, del = 0;
  for (const d of DIRS) for (const f of walk(path.join(dataDir, d))) {
    const rel = `${d}/${f.rel}`; seen.add(rel);
    const sig = `${f.size}:${f.mtime}`, was = known.get(rel);
    if (was === sig || (was?.endsWith(':remote') && was.startsWith(`${f.size}:`))) { known.set(rel, sig); continue; }
    await store.put(`files/${rel}`, fs.readFileSync(path.join(dataDir, rel))); known.set(rel, sig); up++;
  }
  for (const rel of [...known.keys()]) if (!seen.has(rel)) { await store.del(`files/${rel}`); known.delete(rel); del++; }
  return { up, del };
}

// ── backups: backups/sumova-YYYY-MM-DD.tar.gz = consistent DB copy + uploads + private
export async function backup(store, dataDir, { date = riyadhDate() } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smv-bk-'));
  try {
    const db = new DatabaseSync(dbFile(dataDir));
    db.exec(`VACUUM INTO '${path.join(tmp, 'sumova.db').replace(/'/g, "''")}'`); // consistent snapshot while the site runs
    db.close();
    const out = path.join(tmp, 'backup.tar.gz');
    const parts = DIRS.filter((d) => fs.existsSync(path.join(dataDir, d)));
    execFileSync('tar', ['-czf', out, '-C', tmp, 'sumova.db', ...(parts.length ? ['-C', dataDir, ...parts] : [])]);
    const key = `backups/sumova-${date}.tar.gz`;
    await store.put(key, fs.readFileSync(out));
    await prune(store, date);
    return { key, bytes: fs.statSync(out).size };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

export async function listBackups(store) {
  return (await store.list('backups/')).filter((o) => /sumova-\d{4}-\d{2}-\d{2}\.tar\.gz$/.test(o.key)).sort((a, b) => a.key.localeCompare(b.key));
}

// keeps the last KEEP_DAYS days including today (the R2 lifecycle rule does the same; this is the fallback)
export async function prune(store, today = riyadhDate()) {
  const cut = new Date(new Date(today + 'T00:00:00Z').getTime() - (KEEP_DAYS - 1) * 864e5).toISOString().slice(0, 10);
  const old = (await listBackups(store)).filter((o) => /sumova-(\d{4}-\d{2}-\d{2})/.exec(o.key)[1] < cut);
  for (const o of old) await store.del(o.key);
  return old.length;
}

export async function hasBackupFor(store, date = riyadhDate()) {
  return (await listBackups(store)).some((o) => o.key.endsWith(`sumova-${date}.tar.gz`));
}

// Extracts a backup into targetDir (database + uploads + private). key: full key, a date, or "latest".
export async function restoreBackup(store, key, targetDir) {
  const all = await listBackups(store);
  const o = key === 'latest' ? all.at(-1) : all.find((b) => b.key === key || b.key.endsWith(`sumova-${key}.tar.gz`));
  if (!o) throw new Error('backup not found: ' + key);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smv-rs-'));
  try {
    const file = path.join(tmp, 'b.tar.gz');
    fs.writeFileSync(file, await store.get(o.key));
    fs.mkdirSync(targetDir, { recursive: true });
    for (const f of ['sumova.db', 'sumova.db-wal', 'sumova.db-shm']) fs.rmSync(path.join(targetDir, f), { force: true });
    execFileSync('tar', ['-xzf', file, '-C', targetDir]);
    return o.key;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, a, b] = process.argv.slice(2);
  const store = openStore();
  if (!store) { console.error('No object store configured (set R2_* or OBJ_DIR).'); process.exit(2); }
  const dataDir = process.env.DATA_DIR || path.resolve('data');
  const main = {
    backup: async () => console.log(await backup(store, dataDir)),
    list: async () => (await listBackups(store)).forEach((o) => console.log(o.key, Math.round(o.size / 1024) + ' KB')),
    restore: async () => { if (!a || !b) throw new Error('usage: restore <key|date|latest> <targetDir>'); console.log('restored', await restoreBackup(store, a, path.resolve(b)), '→', path.resolve(b)); },
  }[cmd];
  if (!main) { console.error('usage: node ops/data.mjs backup | list | restore <key|date|latest> <targetDir>'); process.exit(2); }
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
