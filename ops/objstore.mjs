// Object store used for persistence on Cloudflare: R2 (S3 API) in production, a plain folder in tests.
//   R2:     R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY
//   folder: OBJ_DIR=/some/dir
import fs from 'node:fs';
import path from 'node:path';
import { AwsClient } from 'aws4fetch';

const keyPath = (k) => k.split('/').map(encodeURIComponent).join('/');
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function r2Store({ endpoint, bucket, accessKeyId, secretAccessKey }) {
  const aws = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
  const base = `${endpoint.replace(/\/$/, '')}/${bucket}`;
  const call = async (method, key, init = {}) => {
    const r = await aws.fetch(`${base}/${keyPath(key)}`, { method, ...init });
    if (!r.ok && !(method === 'GET' && r.status === 404) && !(method === 'DELETE' && r.status === 404)) throw new Error(`R2 ${method} ${key}: ${r.status} ${await r.text()}`);
    return r;
  };
  return {
    kind: 'r2',
    async put(key, body) { await call('PUT', key, { body }); },
    async get(key) { const r = await call('GET', key); return r.status === 404 ? null : Buffer.from(await r.arrayBuffer()); },
    async del(key) { await call('DELETE', key); },
    async list(prefix = '') {
      const out = []; let token = '';
      do {
        const q = new URLSearchParams({ 'list-type': '2', prefix, ...(token ? { 'continuation-token': token } : {}) });
        const r = await aws.fetch(`${base}?${q}`);
        if (!r.ok) throw new Error(`R2 LIST ${prefix}: ${r.status} ${await r.text()}`);
        const x = await r.text();
        for (const m of x.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          out.push({ key: unxml(/<Key>([\s\S]*?)<\/Key>/.exec(m[1])[1]), size: Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1] || 0) });
        }
        token = /<IsTruncated>true<\/IsTruncated>/.test(x) ? unxml(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(x)?.[1] || '') : '';
      } while (token);
      return out;
    },
  };
}

function dirStore(root) {
  const p = (k) => path.join(root, ...k.split('/'));
  const walk = (dir, rel = '') => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name), rel + e.name + '/') : [{ key: rel + e.name, size: fs.statSync(path.join(dir, e.name)).size }]) : []);
  return {
    kind: 'dir',
    async put(key, body) { fs.mkdirSync(path.dirname(p(key)), { recursive: true }); fs.writeFileSync(p(key), body); },
    async get(key) { return fs.existsSync(p(key)) ? fs.readFileSync(p(key)) : null; },
    async del(key) { fs.rmSync(p(key), { force: true }); },
    async list(prefix = '') { return walk(root).filter((o) => o.key.startsWith(prefix)); },
  };
}

export function openStore(env = process.env) {
  if (env.OBJ_DIR) return dirStore(env.OBJ_DIR);
  if (env.R2_BUCKET && env.R2_ENDPOINT && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY)
    return r2Store({ endpoint: env.R2_ENDPOINT, bucket: env.R2_BUCKET, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY });
  return null;
}
