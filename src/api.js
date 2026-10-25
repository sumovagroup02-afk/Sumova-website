// Small REST API for integrations (n8n, Zapier, a CRM). Auth: "Authorization: Bearer smv_…"
import express from 'express';
import { one, all, run, tx, J, audit } from './db.js';
import { sha, rateLimit } from './auth.js';
import { STATUS } from './site/render.js';

export const apiRouter = express.Router();
apiRouter.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (rateLimit('api:' + req.ip, 300, 60 * 1000)) return res.status(429).json({ error: 'rate_limited' });
  const m = /^Bearer\s+(smv_[A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization || '');
  const key = m && one('SELECT * FROM api_keys WHERE key_hash=?', sha(m[1]));
  if (!key) return res.status(401).json({ error: 'unauthorized' });
  run("UPDATE api_keys SET last_used=datetime('now') WHERE id=?", key.id);
  req.apiKey = key;
  next();
});

const out = (r) => ({
  code: r.code, kind: r.kind, status: r.status, name: r.name, org: r.org, phone: r.phone, email: r.email, message: r.message,
  items: J(r.items, []), extra: J(r.extra, {}), has_quote: !!r.quote_file, decision: r.decision, created_at: r.created_at, updated_at: r.updated_at,
});

apiRouter.get('/requests', (req, res) => {
  const where = [], args = [];
  if (STATUS[req.query.status]) { where.push('status=?'); args.push(req.query.status); }
  if (/^\d{4}-\d{2}-\d{2}/.test(req.query.since || '')) { where.push('created_at>=?'); args.push(String(req.query.since).slice(0, 19).replace('T', ' ')); }
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  res.json({ data: all(`SELECT * FROM requests ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ${limit}`, ...args).map(out) });
});
apiRouter.get('/requests/:code', (req, res) => {
  const r = one('SELECT * FROM requests WHERE code=?', String(req.params.code).toUpperCase());
  if (!r) return res.status(404).json({ error: 'not_found' });
  res.json({ data: out(r) });
});
apiRouter.patch('/requests/:code', (req, res) => {
  const r = one('SELECT * FROM requests WHERE code=?', String(req.params.code).toUpperCase());
  if (!r) return res.status(404).json({ error: 'not_found' });
  const { status, note } = req.body || {};
  if (status !== undefined) {
    if (!STATUS[status]) return res.status(422).json({ error: 'invalid_status', allowed: Object.keys(STATUS) });
    if (status === 'quoted' && !r.quote_file) return res.status(422).json({ error: 'quote_file_required' });
  }
  tx(() => {
    if (status && status !== r.status) {
      run("UPDATE requests SET status=?, updated_at=datetime('now') WHERE id=?", status, r.id);
      run('INSERT INTO request_events(request_id,actor,type,note) VALUES(?,?,?,?)', r.id, `API: ${req.apiKey.name}`, 'status', `${STATUS[r.status]?.ar} ← ${STATUS[status].ar}`);
    }
    if (note) run('INSERT INTO request_events(request_id,actor,type,note) VALUES(?,?,?,?)', r.id, `API: ${req.apiKey.name}`, 'note', String(note).slice(0, 500));
  });
  audit({ id: null, name: `API: ${req.apiKey.name}` }, 'status', 'request', r.id, `${r.code}: ${status || 'note'}`);
  res.json({ data: out(one('SELECT * FROM requests WHERE id=?', r.id)) });
});
apiRouter.use((_req, res) => res.status(404).json({ error: 'not_found' }));
