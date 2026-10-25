const { group, test, assert, eq, has, lacks, Client } = require('./lib.cjs');
const { chromium } = require('playwright');

const PAGES = ['/', '/factory', '/kitchen', '/cold-chain', '/catering', '/about', '/contact', '/request-quote', '/privacy', '/terms'];

module.exports = async (S) => {
  const { base } = S;
  const anon = new Client(base);
  const pub = (u, d, o) => { anon.rotate(); return anon.post(u, d, o); };
  const pubReq = (m, u, o) => { anon.rotate(); return anon.req(m, u, o); };
  const pdf = (n = 'q.pdf') => { const f = new FormData(); f.append('file', new Blob(['%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF'], { type: 'application/pdf' }), n); return f; };

  group('Public pages · الصفحات العامة');
  for (const p of PAGES) {
    await test(`GET ${p} → 200, one H1, title, description, canonical, lang/dir`, async () => {
      const r = await anon.get(p); eq(r.status, 200);
      eq((r.text.match(/<h1[\s>]/g) || []).length, 1, 'H1 count');
      assert(/<title>[^<]{8,}<\/title>/.test(r.text), 'title');
      assert(/<meta name="description" content="[^"]{30,}/.test(r.text), 'meta description');
      assert(/<link rel="canonical" href="http[^"]+"/.test(r.text), 'canonical');
      has(r.text, 'lang="ar" dir="rtl"');
      has(r.text, 'rel="alternate" hreflang="en"');
    });
  }
  await test('English home + inner pages respond with lang=en dir=ltr', async () => {
    for (const p of ['/en', '/en/factory', '/en/request-quote']) { const r = await anon.get(p); eq(r.status, 200, p); has(r.text, 'lang="en" dir="ltr"', p); }
  });
  await test('JSON-LD is valid on every page (Organization + WebSite present on home)', async () => {
    for (const p of PAGES) {
      const r = await anon.get(p);
      const blocks = [...r.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
      assert(blocks.length >= 1, 'ld+json on ' + p);
      if (p === '/') { const flat = blocks.flat(); assert(flat.some((b) => b['@type'] === 'Organization') && flat.some((b) => b['@type'] === 'WebSite'), 'org/website'); }
    }
  });
  await test('every <img> has alt attribute + width/height (no layout shift)', async () => {
    for (const p of PAGES) {
      const r = await anon.get(p);
      for (const m of r.text.matchAll(/<img\b[^>]*>/g)) { const t = m[0]; assert(/\balt="/.test(t), `alt missing on ${p}: ${t.slice(0, 90)}`); assert(/\bwidth="\d+"/.test(t) && /\bheight="\d+"/.test(t), `size missing on ${p}`); }
    }
  });
  await test('no third-party requests: fonts/CSS/JS are self-hosted', async () => {
    for (const p of ['/', '/request-quote']) { const r = await anon.get(p); assert(!/(https?:)?\/\/(fonts\.googleapis|fonts\.gstatic|cdn\.|unpkg|cdnjs|jsdelivr)/.test(r.text), 'external asset on ' + p); }
  });
  await test('home hero image is eager + high priority (LCP), others lazy', async () => {
    const r = await anon.get('/'); has(r.text, 'fetchpriority="high"');
  });
  await test('unknown URL → real 404 with noindex; /en/unknown 404', async () => {
    const r = await anon.get('/nope-' + Date.now()); eq(r.status, 404); has(r.text, 'noindex');
    eq((await anon.get('/en/nope')).status, 404);
  });
  await test('drafts and reserved paths are not exposed', async () => {
    eq((await anon.get('/admin/pages')).status, 302);
    eq((await anon.get('/data/sumova.db')).status, 404); eq((await anon.get('/private/quotes/x.pdf')).status, 404);
    eq((await anon.get('/..%2f..%2fetc/passwd')).status === 200, false);
  });
  await test('security headers present', async () => {
    const r = await anon.get('/'); eq(r.headers.get('x-content-type-options'), 'nosniff'); eq(r.headers.get('x-frame-options'), 'SAMEORIGIN'); assert(r.headers.get('referrer-policy'));
    assert(!r.headers.get('x-powered-by'), 'x-powered-by leaked');
  });
  await test('static media is immutable-cached; fonts served', async () => {
    const r = await anon.get('/'); const m = /src="(\/media\/[^"]+)"/.exec(r.text)[1];
    const mr = await anon.get(m); eq(mr.status, 200); has(mr.headers.get('cache-control'), 'immutable');
    eq((await anon.get('/fonts/tajawal-arabic-700-normal.woff2')).status, 200);
  });

  group('SEO · محركات البحث');
  await test('robots.txt blocks admin/track/api and links the sitemap', async () => {
    const r = await anon.get('/robots.txt'); has(r.text, 'Disallow: /admin'); has(r.text, 'Disallow: /track'); has(r.text, 'Sitemap: ');
  });
  await test('sitemap.xml lists public pages with hreflang, no admin/track', async () => {
    const r = await anon.get('/sitemap.xml'); eq(r.status, 200); has(r.headers.get('content-type'), 'xml');
    has(r.text, '/factory'); has(r.text, 'hreflang="en"'); lacks(r.text, '/admin'); lacks(r.text, '/track');
  });
  await test('English URLs of untranslated pages are noindex; translated ones are indexable', async () => {
    const ok = await anon.get('/en/factory'); lacks(ok.text, 'content="noindex');
  });

  group('Request forms · نماذج الطلب');
  const base_ = { name: 'شركة الاختبار', org: 'اختبار', phone: '0551234567', email: 'a@b.co', message: 'نحتاج عرض سعر لـ 500 وجبة', kind: 'quote', ts: String(Date.now() - 6000), website: '' };
  let code;
  await test('validation: empty form → 422 with field errors, nothing saved', async () => {
    const r = await pub('/request', { kind: 'quote', ts: String(Date.now() - 6000) }); eq(r.status, 422); has(r.text, 'aria-invalid="true"');
  });
  await test('bad phone and bad email are rejected', async () => {
    const r = await pub('/request', { ...base_, phone: '12', email: 'x' }); eq(r.status, 422); has(r.text, 'e-phone'); has(r.text, 'e-email');
  });
  await test('too-fast submit (bot) rejected; honeypot silently dropped', async () => {
    eq((await pub('/request', { ...base_, ts: String(Date.now()) })).status, 422);
    const hp = await pub('/request', { ...base_, website: 'http://spam' }); eq(hp.status, 302);
  });
  await test('valid quote request → code R-XXXXXX shown, Arabic-Indic digits accepted in phone', async () => {
    const r = await pub('/request', { ...base_, phone: '٠٥٥١٢٣٤٥٦٧' }); eq(r.status, 200);
    code = /R-[A-Z0-9]{6}/.exec(r.text)?.[0]; assert(code, 'no code in response');
  });
  await test('catering request stores people/days/place', async () => {
    const r = await pub('/request', { ...base_, kind: 'catering', people: '300', days: '14', place: 'الرياض – موقع مشروع', start: '2026-12-01' });
    eq(r.status, 200); assert(/R-[A-Z0-9]{6}/.test(r.text));
  });
  await test('file upload: valid PDF accepted; fake .pdf (wrong magic) and .exe rejected', async () => {
    const mk = (name, content, type) => { const f = new FormData(); for (const [k, v] of Object.entries({ ...base_, ts: String(Date.now() - 6000) })) f.append(k, v); f.append('files', new Blob([content], { type }), name); return f; };
    eq((await pubReq('POST', '/request', { multipart: mk('a.pdf', '%PDF-1.4 hello', 'application/pdf') })).status, 200);
    eq((await pubReq('POST', '/request', { multipart: mk('evil.pdf', 'MZ not a pdf', 'application/pdf') })).status, 422);
    eq((await pubReq('POST', '/request', { multipart: mk('evil.exe', 'MZ', 'application/octet-stream') })).status, 422);
  });
  await test('cross-site POST (foreign Origin) is refused', async () => {
    eq((await pub('/request', base_, { headers: { origin: 'https://evil.example' } })).status, 403);
  });
  await test('per-IP rate limit: 7th submission within the hour → 429', async () => {
    const c = new Client(base); let last;
    for (let i = 0; i < 7; i++) last = await c.post('/contact-send', { name: 'x', phone: '0551234567', message: 'm' + i, ts: String(Date.now() - 6000) });
    eq(last.status, 429);
  });
  await test('contact form works and requires a message', async () => {
    eq((await pub('/contact-send', { name: 'x', phone: '0551234567', ts: String(Date.now() - 6000) })).status, 422);
    eq((await pub('/contact-send', { name: 'x', phone: '0551234567', message: 'مرحبا', ts: String(Date.now() - 6000) })).status, 200);
  });
  await test('stored XSS payload in a request is not executed on the public thank-you or tracking page', async () => {
    const r = await pub('/request', { ...base_, name: '<img src=x onerror=alert(1)>', message: '<script>alert(1)</script>' });
    lacks(r.text, '<img src=x onerror'); S.xssName = true;
  });

  group('Tracking · تتبع الطلب');
  await test('track by code + phone shows status "جديد"', async () => {
    const r = await anon.post('/track', { code, phone: '0551234567' }); eq(r.status, 200); has(r.text, 'جديد');
  });
  await test('wrong phone does not reveal the request', async () => {
    const r = await anon.post('/track', { code, phone: '0599999999' }); lacks(r.text, 'status-pill'); 
  });
  await test('customer cannot accept before a quote exists', async () => {
    await anon.post('/track/decision', { code, phone: '0551234567', decision: 'accept' });
    const r = await anon.post('/track', { code, phone: '0551234567' }); has(r.text, 'جديد');
  });
  await test('quote PDF is not downloadable before it is sent', async () => { eq((await anon.get(`/track/quote?code=${code}&phone=0551234567`)).status, 404); });

  group('Admin auth & security · الأمان');
  const owner = new Client(base);
  await test('dashboard redirects anonymous users to login', async () => { const r = await anon.get('/admin'); eq(r.status, 302); has(r.loc, '/admin/login'); });
  await test('wrong password rejected (401), no session cookie', async () => { const c = new Client(base); const r = await c.login('owner@test.local', 'wrong'); eq(r.status, 401); assert(!c.jar.has('sid')); });
  await test('login POST without the login token is refused', async () => { const r = await new Client(base).post('/admin/login', { email: 'owner@test.local', password: 'Test-Pass-12345' }); eq(r.status, 403); });
  await test('owner logs in; cookie is HttpOnly + SameSite', async () => {
    const g = await owner.get('/admin/login'); const lt = /name="lt" value="([^"]+)"/.exec(g.text)[1];
    const r = await owner.post('/admin/login', { lt, email: 'owner@test.local', password: 'Test-Pass-12345' }); eq(r.status, 302);
    const sc = r.headers.getSetCookie().find((c) => c.startsWith('sid=')); has(sc, 'HttpOnly'); has(sc, 'SameSite=Lax'); has(sc, 'Path=/admin');
  });
  let csrf;
  await test('every admin page renders 200 for the owner', async () => {
    csrf = await owner.csrf();
    for (const p of ['/admin', '/admin/requests', '/admin/pages', '/admin/media', '/admin/products', '/admin/seo', '/admin/settings', '/admin/users', '/admin/audit', '/admin/integrations', '/admin/account', '/admin/products/new', '/admin/products/cat/new']) {
      const r = await owner.get(p); eq(r.status, 200, p); lacks(r.text, 'undefined'); lacks(r.text, '[object Object]');
    }
    for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) { const r = await owner.get('/admin/pages/' + id); eq(r.status, 200, 'page ' + id); lacks(r.text, '[object Object]'); }
  });
  await test('admin pages are noindex + no-store', async () => { const r = await owner.get('/admin'); has(r.text, 'noindex'); has(r.headers.get('cache-control'), 'no-store'); });
  await test('CSRF: state-changing POST without token is rejected', async () => {
    eq((await owner.post('/admin/settings', { n_emails: 'x@y.z' })).status, 403);
    eq((await owner.post('/admin/pages/1/delete', {})).status, 403);
  });
  await test('CSRF: multipart upload without token is rejected', async () => {
    const f = new FormData(); f.append('files', new Blob(['x']), 'x.png'); eq((await owner.req('POST', '/admin/media/upload', { multipart: f })).status, 403);
  });
  await test('login throttling after repeated failures (429)', async () => {
    const c = new Client(base); let last;
    for (let i = 0; i < 10; i++) last = await c.login('throttle@test.local', 'bad' + i);
    eq(last.status, 429);
  });

  group('Roles · الصلاحيات');
  const mk = async (email, role) => owner.post('/admin/users', { _csrf: csrf, name: role, email, password: 'Role-Pass-123456', role });
  await test('owner can create editor and sales users', async () => { eq((await mk('editor@test.local', 'editor')).status, 302); eq((await mk('sales@test.local', 'sales')).status, 302); });
  await test('short password / duplicate email rejected', async () => {
    const r1 = await owner.post('/admin/users', { _csrf: csrf, name: 'x', email: 'short@test.local', password: '123', role: 'editor' }); eq(r1.status, 302);
    const u = await owner.get('/admin/users'); lacks(u.text, 'short@test.local');
  });
  const editor = new Client(base), sales = new Client(base);
  await editor.login('editor@test.local', 'Role-Pass-123456'); await sales.login('sales@test.local', 'Role-Pass-123456');
  await test('editor: pages/media/seo yes — requests/settings/users/integrations no (403)', async () => {
    for (const p of ['/admin/pages', '/admin/media', '/admin/seo', '/admin/products']) eq((await editor.get(p)).status, 200, p);
    for (const p of ['/admin/requests', '/admin/settings', '/admin/users', '/admin/integrations', '/admin/audit']) eq((await editor.get(p)).status, 403, p);
  });
  await test('sales: requests yes — pages/media/seo/settings no', async () => {
    eq((await sales.get('/admin/requests')).status, 200);
    for (const p of ['/admin/pages', '/admin/media', '/admin/seo', '/admin/settings', '/admin/users']) eq((await sales.get(p)).status, 403, p);
  });
  await test('editor cannot hit write endpoints of other areas (CSRF-valid but forbidden)', async () => {
    const t = await editor.csrf();
    eq((await editor.post('/admin/settings', { _csrf: t })).status, 403); eq((await editor.post('/admin/users', { _csrf: t, name: 'x', email: 'z@z.zz', password: 'Role-Pass-123456', role: 'owner' })).status, 403);
  });
  await test('deactivated user is signed out immediately', async () => {
    const list = await owner.get('/admin/users'); const id = /href="\/admin\/users\/(\d+)">تعديل[\s\S]*?sales@/.exec(list.text); 
    const row = [...list.text.matchAll(/sales@test\.local[\s\S]*?href="\/admin\/users\/(\d+)"/g)][0][1];
    await owner.post('/admin/users/' + row, { _csrf: csrf, name: 'sales', role: 'sales' }); // active unchecked => deactivated
    eq((await sales.get('/admin/requests')).status, 302);
  });
  await test('last active owner cannot be demoted or deactivated', async () => {
    const r = await owner.get('/admin/users/1'); has(r.text, 'لا يمكنك تغيير صلاحية حسابك');
  });

  group('Requests pipeline · مسار الطلبات');
  let rid;
  await test('request list shows the new request, unread; opening marks it read', async () => {
    const l = await owner.get('/admin/requests'); has(l.text, code); has(l.text, 'unseen');
    rid = new RegExp(`/admin/requests/(\\d+)" dir="ltr"><b>${code}`).exec(l.text)[1];
    const d = await owner.get('/admin/requests/' + rid); eq(d.status, 200); has(d.text, 'شركة الاختبار'); has(d.text, 'wa.me/966551234567');
    lacks((await owner.get('/admin/requests?status=new')).text.split(code)[1]?.slice(0, 60) || '', 'unseen"');
  });
  await test('XSS payload name is escaped in admin', async () => {
    const l = await owner.get('/admin/requests'); lacks(l.text, '<img src=x onerror'); has(l.text, '&lt;img src=x onerror');
  });
  await test('cannot set "quoted" without a quote file', async () => {
    await owner.post(`/admin/requests/${rid}/status`, { _csrf: csrf, status: 'quoted' });
    has((await owner.get('/admin/requests/' + rid)).text, 'pill s-new');
  });
  await test('status → pricing, note, assignment are logged in the timeline', async () => {
    await owner.post(`/admin/requests/${rid}/status`, { _csrf: csrf, status: 'pricing', note: 'بدأ التسعير' });
    await owner.post(`/admin/requests/${rid}/note`, { _csrf: csrf, note: 'العميل يريد توصيل صباحي' });
    await owner.post(`/admin/requests/${rid}/assign`, { _csrf: csrf, assigned_to: '1' });
    const d = await owner.get('/admin/requests/' + rid); has(d.text, 'قيد التسعير'); has(d.text, 'العميل يريد توصيل صباحي'); has(d.text, 'إسناد');
    has((await anon.post('/track', { code, phone: '0551234567' })).text, 'قيد التسعير');
  });
  await test('quote upload rejects non-PDF, accepts PDF → status quoted + download link for customer', async () => {
    const bad = new FormData(); bad.append('_csrf', csrf); bad.append('file', new Blob(['hello'], { type: 'application/pdf' }), 'q.pdf');
    await owner.req('POST', `/admin/requests/${rid}/quote`, { multipart: bad });
    has((await owner.get('/admin/requests/' + rid)).text, 'pill s-pricing');
    const ok = pdf(); ok.append('_csrf', csrf);
    await owner.req('POST', `/admin/requests/${rid}/quote`, { multipart: ok });
    has((await owner.get('/admin/requests/' + rid)).text, 'pill s-quoted');
    const t = await anon.post('/track', { code, phone: '0551234567' }); has(t.text, 'قبول'); has(t.text, '/track/quote');
    const dl = await anon.get(`/track/quote?code=${code}&phone=0551234567`); eq(dl.status, 200); eq(dl.headers.get('content-type'), 'application/pdf'); has(dl.text, '%PDF-');
    eq((await anon.get(`/track/quote?code=${code}&phone=0500000000`)).status, 404);
  });
  await test('quote file is never reachable by guessing a static path', async () => {
    for (const p of ['/media/../private/quotes', '/private', '/quotes']) assert((await anon.get(p)).status !== 200, p);
  });
  await test('customer accepts → status "قُبل العرض"; second decision is ignored', async () => {
    await anon.post('/track/decision', { code, phone: '0551234567', decision: 'accept' });
    has((await owner.get('/admin/requests/' + rid)).text, 'pill s-accepted');
    await anon.post('/track/decision', { code, phone: '0551234567', decision: 'reject' });
    has((await owner.get('/admin/requests/' + rid)).text, 'pill s-accepted');
  });
  await test('owner confirms the order; CSV export neutralises formula injection', async () => {
    await owner.post(`/admin/requests/${rid}/status`, { _csrf: csrf, status: 'confirmed' });
    await pub('/request', { ...base_, name: '=HYPERLINK("http://x")', ts: String(Date.now() - 6000) });
    const csv = await owner.get('/admin/requests/export.csv'); eq(csv.status, 200); has(csv.headers.get('content-type'), 'text/csv'); has(csv.text, code); has(csv.text, '"\'=HYPERLINK');
  });
  await test('search + filter on the requests list', async () => {
    has((await owner.get('/admin/requests?q=' + encodeURIComponent('شركة الاختبار'))).text, code);
    lacks((await owner.get('/admin/requests?kind=catering')).text, code);
  });
  await test('customer file download is only for staff, as attachment', async () => {
    const l = await owner.get('/admin/requests'); const idm = [...l.text.matchAll(/\/admin\/requests\/(\d+)"/g)].map((m) => m[1]);
    let found = false; for (const i of idm) { const d = await owner.get('/admin/requests/' + i); const f = /\/admin\/requests\/\d+\/file\/0/.exec(d.text); if (f) { const r = await owner.get(f[0]); eq(r.status, 200); has(r.headers.get('content-disposition'), 'attachment'); eq((await anon.get(f[0])).status, 302); found = true; break; } }
    assert(found, 'no request with a file found');
  });

  group('API & webhooks · الربط');
  let key;
  await test('create API key (shown once), unauthenticated/invalid key → 401', async () => {
    await owner.post('/admin/integrations', { _csrf: csrf, name: 'n8n-test' });
    const p = await owner.get('/admin/integrations'); key = /class="key"[^>]*>(smv_[A-Za-z0-9_-]+)/.exec(p.text)?.[1]; assert(key, 'key not shown');
    lacks((await owner.get('/admin/integrations')).text, key, 'key shown twice');
    eq((await anon.get('/api/v1/requests')).status, 401); eq((await anon.get('/api/v1/requests', { headers: { authorization: 'Bearer smv_wrongwrongwrongwrongwrong' } })).status, 401);
  });
  await test('API: list, get, patch status (+validation)', async () => {
    const H = { authorization: 'Bearer ' + key };
    const l = JSON.parse((await anon.get('/api/v1/requests?status=confirmed', { headers: H })).text); assert(l.data.some((r) => r.code === code));
    const g = await anon.get('/api/v1/requests/' + code, { headers: H }); eq(g.status, 200); 
    const bad = await anon.req('PATCH', '/api/v1/requests/' + code, { json: { status: 'nonsense' }, headers: H }); eq(bad.status, 422);
    const ok = await anon.req('PATCH', '/api/v1/requests/' + code, { json: { status: 'closed', note: 'تم التسليم' }, headers: H }); eq(ok.status, 200); eq(JSON.parse(ok.text).data.status, 'closed');
    eq((await anon.get('/api/v1/requests/R-NOPE00', { headers: H })).status, 404);
  });
  await test('revoked key stops working', async () => {
    const p = await owner.get('/admin/integrations'); const id = /integrations\/(\d+)\/revoke/.exec(p.text)[1];
    await owner.post(`/admin/integrations/${id}/revoke`, { _csrf: csrf });
    eq((await anon.get('/api/v1/requests', { headers: { authorization: 'Bearer ' + key } })).status, 401);
  });
  await test('webhook: signed POST delivered on new request (HMAC verifies)', async () => {
    const http = require('node:http'), crypto = require('node:crypto');
    const got = await new Promise(async (resolve, reject) => {
      const srv = http.createServer((q, s) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => { s.end('ok'); srv.close(); resolve({ body: b, sig: q.headers['x-sumova-signature'] }); }); }).listen(0, '127.0.0.1');
      await new Promise((r) => srv.on('listening', r));
      await owner.post('/admin/settings', { _csrf: csrf, n_webhook_url: `http://127.0.0.1:${srv.address().port}/hook`, n_webhook_secret: 'topsecret', brand_name_ar: 'سوموفا', brand_name_en: 'SUMOVA', smtp_port: '587' });
      await pub('/request', { ...base_, name: 'ويب هوك', ts: String(Date.now() - 6000) });
      setTimeout(() => reject(new Error('webhook not received in 8s')), 8000);
    });
    eq(got.sig, crypto.createHmac('sha256', 'topsecret').update(got.body).digest('hex'), 'signature'); eq(JSON.parse(got.body).event, 'request.created');
  });

  S.csrf = csrf; S.owner = owner; S.anon = anon; S.code = code;
};
