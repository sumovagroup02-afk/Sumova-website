import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UPLOAD_DIR, one, run, getSettings } from './src/db.js';
import { seedIfEmpty } from './src/seed.js';
import { loadUser } from './src/auth.js';
import { siteRouter, notFound } from './src/site/routes.js';
import { adminRouter } from './src/admin/routes.js';
import { apiRouter } from './src/api.js';
import { sitemapXml, robotsTxt } from './src/seo.js';
import { makeCtx } from './src/site/render.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : false);

// security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.COOKIE_SECURE === '1') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.get('/healthz', (_req, res) => { one('SELECT 1 x'); res.type('text').send('ok'); });

// static assets
const longCache = { maxAge: '365d', immutable: true };
app.use('/media', express.static(UPLOAD_DIR, longCache));
app.use('/fonts', express.static(path.join(here, 'public/fonts'), longCache));
app.use('/brand', express.static(path.join(here, 'public/brand'), { maxAge: '7d' }));
app.get('/site.webmanifest', (_req, res) => res.type('application/manifest+json').sendFile(path.join(here, 'public/site.webmanifest')));
app.use('/css', express.static(path.join(here, 'public/css'), { maxAge: '1h' }));
app.use('/js', express.static(path.join(here, 'public/js'), { maxAge: '1h' }));

// body parsing: dashboard forms may be large, public forms are small
app.use('/admin', express.urlencoded({ extended: true, limit: '3mb', parameterLimit: 8000 }));
app.use(express.urlencoded({ extended: true, limit: '60kb' }));
app.use('/api', express.json({ limit: '200kb' }));

app.get('/robots.txt', (req, res) => res.type('text').send(robotsTxt(makeCtx(req, 'ar').siteUrl)));
app.get('/sitemap.xml', (req, res) => res.type('application/xml').send(sitemapXml(makeCtx(req, 'ar').siteUrl)));

app.use('/api/v1', apiRouter);
app.use('/admin', loadUser, adminRouter);

// redirects managed from the dashboard (SEO)
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const r = one('SELECT * FROM redirects WHERE from_path=?', req.path.replace(/(.)\/$/, '$1'));
  if (r) { run('UPDATE redirects SET hits=hits+1 WHERE id=?', r.id); return res.redirect(r.code, r.to_path); }
  next();
});

app.use('/en', siteRouter('en'));
app.use('/', siteRouter('ar'));

app.use((req, res) => notFound(req, res, req.path.startsWith('/en') ? 'en' : 'ar'));
app.use((err, req, res, _next) => {
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).send('حجم الملف أكبر من المسموح (8 ميجابايت).');
  res.status(500).type('text').send('حدث خطأ غير متوقع. حاول مرة أخرى.');
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await seedIfEmpty();
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`SUMOVA site on http://localhost:${port}`));
}
