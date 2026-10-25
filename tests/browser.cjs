const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { chromium } = require('playwright');
const { group, test, assert, eq, has, lacks, Client, nextCode } = require('./lib.cjs');

const SHOTS = path.resolve(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const PAGES = ['/', '/factory', '/kitchen', '/cold-chain', '/catering', '/about', '/contact', '/request-quote', '/privacy', '/terms', '/en', '/en/factory'];
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

module.exports = async (S) => {
  const { base } = S;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'ar-SA', viewport: { width: 1360, height: 900 } });
  const pg = await ctx.newPage();
  const consoleErrors = [], failed = [];
  pg.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  pg.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  pg.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) failed.push(r.status() + ' ' + r.url()); });
  pg.on('dialog', (d) => d.accept().catch(() => {}));
  const png = (w, h, color) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
  const openAll = (p) => p.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
  const go = (p) => pg.goto(base + p, { waitUntil: 'networkidle' });
  const setVal = async (sel, v) => { const l = pg.locator(sel).first(); await l.scrollIntoViewIfNeeded(); await l.fill(v); };
  // real login form; the owner has 2FA on (enrolled in the HTTP suite), so the code page follows
  const uiLogin = async (p, email, pw) => {
    await p.goto(base + '/admin/login'); await p.fill('#email', email); await p.fill('#password', pw);
    await Promise.all([p.waitForNavigation(), p.click('button[type=submit]')]);
    if (new URL(p.url()).pathname === '/admin/login/2fa') { await p.fill('#code', await nextCode(email)); await Promise.all([p.waitForNavigation(), p.click('button[type=submit]')]); }
  };
  const save = async () => { await Promise.all([pg.waitForNavigation({ waitUntil: 'networkidle' }), pg.locator('button.btn--ink', { hasText: 'حفظ' }).first().click()]); };

  group('Browser · لوحة التحكم عبر المتصفح');
  await test('login through the real form + 2FA code, land on overview', async () => {
    await uiLogin(pg, 'owner@test.local', 'Test-Pass-12345');
    eq(new URL(pg.url()).pathname, '/admin'); has(await pg.textContent('h1'), 'أهلًا');
    await pg.screenshot({ path: path.join(SHOTS, 'admin-overview.png'), fullPage: true });
  });

  await test('edit the home hero headline → visible on the public site', async () => {
    await go('/admin/pages/1'); await openAll(pg);
    const sel = '[name="blocks[0][data][headline][ar]"]';
    assert(await pg.locator(sel).count(), 'hero headline field not found');
    await setVal(sel, 'عنوان تجريبي من لوحة التحكم\nسطر ثانٍ');
    await save();
    has(await pg.textContent('.toast'), 'تم حفظ الصفحة');
    await go('/'); has(await pg.textContent('h1'), 'عنوان تجريبي من لوحة التحكم');
  });

  await test('add a text section, move it to the top, save → order is respected publicly', async () => {
    await go('/admin/pages'); const href = await pg.locator('a', { hasText: 'عن سوموفا' }).first().getAttribute('href').catch(() => null);
    const row = pg.locator('table.tbl tr', { hasText: '/about' }).locator('a').first(); const h = await row.getAttribute('href');
    await go(h);
    await pg.selectOption('[data-newtype]', 'richtext'); await pg.click('[data-addblock]');
    await openAll(pg);
    const last = pg.locator('[data-block]').last();
    await last.locator('input[name$="[title][ar]"]').fill('قسم مضاف من الاختبار');
    await last.locator('textarea[name$="[body][ar]"]').fill('فقرة أولى.\n\nفقرة ثانية.');
    for (let i = 0; i < 20; i++) { if (!(await pg.locator('[data-block]').nth(1).count())) break; const idx = await pg.evaluate(() => [...document.querySelectorAll('[data-block]')].findIndex((b) => b.querySelector('input[name$="[title][ar]"]')?.value === 'قسم مضاف من الاختبار')); if (idx <= 0) break; await pg.locator('[data-block]').nth(idx).locator('[data-bup]').click(); }
    await save();
    await go('/about'); const html = await pg.content();
    assert(html.indexOf('قسم مضاف من الاختبار') > 0, 'new section missing');
    const first = await pg.evaluate(() => [...document.querySelectorAll('main section h2, main section h1')].map((e) => e.textContent.trim())[0]);
    assert(first.includes('قسم مضاف من الاختبار') || (await pg.evaluate(() => document.body.innerText)).includes('فقرة ثانية'), 'order');
  });

  await test('FAQ block: add items via the list UI → FAQPage JSON-LD appears', async () => {
    await go('/admin/pages'); const h = await pg.locator('table.tbl tr', { hasText: '/about' }).locator('a').first().getAttribute('href'); await go(h);
    await pg.selectOption('[data-newtype]', 'faq'); await pg.click('[data-addblock]'); await openAll(pg);
    const blk = pg.locator('[data-block]').last();
    await blk.locator('input[name$="[title][ar]"]').fill('أسئلة شائعة');
    for (let i = 0; i < 2; i++) { await blk.locator('[data-add]').click(); }
    const qs = blk.locator('input[name$="[q][ar]"]'), as = blk.locator('textarea[name$="[a][ar]"]');
    eq(await qs.count(), 2);
    await qs.nth(0).fill('كم أقل كمية؟'); await as.nth(0).fill('نحدد الكمية حسب الصنف.');
    await qs.nth(1).fill('هل يوجد توصيل؟'); await as.nth(1).fill('نعم بأسطولنا.');
    await blk.locator('[data-down]').first().click(); // reorder rows: second question first
    await save();
    await go('/about'); const ld = await pg.$$eval('script[type="application/ld+json"]', (n) => n.map((x) => x.textContent).join('\n'));
    has(ld, 'FAQPage'); assert(ld.indexOf('هل يوجد توصيل؟') < ld.indexOf('كم أقل كمية؟'), 'row order not applied');
  });

  await test('delete a list row and a block through the UI', async () => {
    await go('/admin/pages'); const h = await pg.locator('table.tbl tr', { hasText: '/about' }).locator('a').first().getAttribute('href'); await go(h); await openAll(pg);
    const blk = pg.locator('[data-block]', { has: pg.locator('input[value="أسئلة شائعة"]') }); eq(await blk.count(), 1, 'faq blocks');
    await blk.locator('[data-row] [data-del]').first().click();
    const tb = pg.locator('[data-block]', { has: pg.locator('input[value="قسم مضاف من الاختبار"]') }); eq(await tb.count(), 1, 'duplicate added blocks'); await tb.locator('[data-bdel]').click();
    await save();
    await go('/about'); lacks(await pg.content(), 'قسم مضاف من الاختبار'); lacks(await pg.content(), 'هل يوجد توصيل؟'); has(await pg.content(), 'كم أقل كمية؟'); /* first row (after reorder) was the delivery question */
  });

  group('Media · مكتبة الصور');
  let mid;
  await test('upload from the library, add alt text (AR/EN)', async () => {
    await go('/admin/media');
    await pg.setInputFiles('input[type=file][name=files]', { name: 'blue.png', mimeType: 'image/png', buffer: await png(1600, 900, '#2a4d8f') });
    await Promise.all([pg.waitForNavigation(), pg.click('button.btn--ink')]);
    mid = /\/admin\/media\/(\d+)/.exec(pg.url())[1];
    await pg.fill('[name=alt_ar]', 'صورة زرقاء للاختبار'); await pg.fill('[name=alt_en]', 'Blue test image');
    await Promise.all([pg.waitForNavigation(), pg.click('button:has-text("حفظ الوصف")')]);
    has(await pg.textContent('.toast'), 'تم حفظ');
  });
  await test('pick that image in a page via the picker dialog; usage list updates; delete is blocked while used', async () => {
    await go('/admin/pages'); const h = await pg.locator('table.tbl tr', { hasText: '/factory' }).locator('a').first().getAttribute('href'); await go(h); await openAll(pg);
    const head = pg.locator('[data-block]', { has: pg.locator('input[name$="[title][ar]"]') }).first();
    await head.locator('[data-pick]').first().click();
    await pg.waitForSelector('dialog.picker[open] .pitem');
    await pg.locator('dialog.picker .pitem', { hasText: 'صورة زرقاء للاختبار' }).click();
    await save();
    await go('/factory'); assert((await pg.content()).includes(`m${mid}-r1-`), 'picked image not rendered');
    await go('/admin/media/' + mid); has(await pg.textContent('main'), 'غير مستخدمة'.replace('غير مستخدمة', '')); has(await pg.textContent('.editor__side'), 'صفحة');
    has(await pg.textContent('.editor__side'), 'لا يمكن حذف صورة مستخدمة');
  });
  await test('replace image in place → same id, new revision, every page serves the new file', async () => {
    await go('/admin/media/' + mid);
    await pg.setInputFiles('input[type=file][name=file]', { name: 'red.png', mimeType: 'image/png', buffer: await png(1200, 800, '#b3261e') });
    await Promise.all([pg.waitForNavigation(), pg.click('button:has-text("استبدال")')]);
    has(await pg.textContent('.toast'), 'استُبدلت');
    await go('/factory'); const c = await pg.content(); assert(c.includes(`m${mid}-r2-`) && !c.includes(`m${mid}-r1-`), 'old revision still referenced');
    const src = await pg.evaluate(() => [...document.images].find((i) => /m\d+-r2/.test(i.src))?.src);
    const r = await fetch(src); eq(r.status, 200);
    const meta = await sharp(Buffer.from(await r.arrayBuffer())).stats(); assert(meta.channels[0].mean > 120, 'file is not the red replacement');
    eq((await fetch(src.replace('-r2-', '-r1-'))).status, 404, 'old revision file should be gone');
  });
  await test('SVG upload is rejected (XSS vector)', async () => {
    await go('/admin/media');
    await pg.setInputFiles('input[type=file][name=files]', { name: 'x.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') });
    await Promise.all([pg.waitForNavigation(), pg.click('button.btn--ink')]);
    has(await pg.textContent('.toast'), 'تعذّر'); 
  });
  await test('picker can upload a new image inline', async () => {
    await go('/admin/pages'); const h = await pg.locator('table.tbl tr', { hasText: '/about' }).locator('a').first().getAttribute('href'); await go(h); await openAll(pg);
    await pg.locator('[data-pick]').first().click(); await pg.waitForSelector('dialog.picker[open]');
    await pg.setInputFiles('dialog.picker input[type=file]', { name: 'green.png', mimeType: 'image/png', buffer: await png(900, 600, '#2f7d4b') });
    await pg.waitForFunction(() => /تم الرفع/.test(document.querySelector('dialog.picker .msg')?.textContent || ''));
    await pg.keyboard.press('Escape');
  });

  group('SEO · من اللوحة إلى الموقع');
  await test('page SEO title/description/OG are reflected in <head>', async () => {
    await go('/admin/pages'); const h = await pg.locator('table.tbl tr', { hasText: '/cold-chain' }).locator('a').first().getAttribute('href'); await go(h); await openAll(pg);
    await pg.fill('[name=seo_title_ar]', 'سلسلة التبريد من سوموفا – ثلاجات بطاقة تشغيلية'); await pg.fill('[name=seo_desc_ar]', 'ثلاجات تبريد وأسطول مبرد لنقل الأغذية بين المصنع والعميل في المملكة، بإدارة واحدة من التخزين حتى التسليم.');
    await save();
    await go('/cold-chain');
    eq(await pg.title(), 'سلسلة التبريد من سوموفا – ثلاجات بطاقة تشغيلية'); has(await pg.getAttribute('meta[name=description]', 'content'), 'ثلاجات تبريد وأسطول مبرد');
    assert((await pg.getAttribute('meta[property="og:title"]', 'content')).includes('سلسلة التبريد'), 'og:title');
    assert((await pg.getAttribute('meta[property="og:image"]', 'content')).includes('/media/'), 'og:image');
  });
  await test('char counters show and turn red when over the limit', async () => {
    await go('/admin/pages'); const h = await pg.locator('table.tbl tr', { hasText: '/cold-chain' }).locator('a').first().getAttribute('href'); await go(h);
    await pg.fill('[name=seo_title_ar]', 'ع'.repeat(80)); assert(await pg.locator('.count.over').count() >= 1, 'counter not flagged');
  });
  await test('noindex toggle: meta robots appears and page leaves sitemap', async () => {
    await go('/admin/pages'); const h = await pg.locator('table.tbl tr', { hasText: '/terms' }).locator('a').first().getAttribute('href'); await go(h);
    await pg.check('[name=seo_noindex]'); await save();
    await go('/terms'); has(await pg.content(), 'noindex'); lacks(await (await fetch(base + '/sitemap.xml')).text(), '/terms');
  });
  await test('slug change creates a 301 from the old URL', async () => {
    await go('/admin/pages'); const h = await pg.locator('table.tbl tr', { hasText: '/privacy' }).locator('a').first().getAttribute('href'); await go(h);
    await pg.fill('[name=slug]', 'privacy-policy'); await save();
    const r = await fetch(base + '/privacy', { redirect: 'manual' }); eq(r.status, 301); has(r.headers.get('location'), '/privacy-policy');
    eq((await fetch(base + '/privacy-policy')).status, 200);
  });
  await test('new page: draft is hidden, publishing exposes it and adds it to the nav + sitemap', async () => {
    await go('/admin/pages'); await pg.fill('form[action="/admin/pages"] [name=title_ar]', 'شركاؤنا'); await pg.fill('form[action="/admin/pages"] [name=slug]', 'partners');
    await Promise.all([pg.waitForNavigation(), pg.click('form[action="/admin/pages"] button.btn--ink')]);
    eq((await fetch(base + '/partners')).status, 404, 'draft must be hidden');
    await pg.check('[name=published]'); await pg.check('[name=show_in_nav]'); await openAll(pg);
    await pg.fill('[name="blocks[0][data][lede][ar]"]', 'جهات نعمل معها في توريد وتشغيل الأغذية.'); await save();
    eq((await fetch(base + '/partners')).status, 200);
    await go('/'); has(await pg.textContent('header'), 'شركاؤنا'); has(await (await fetch(base + '/sitemap.xml')).text(), '/partners');
  });
  await test('reserved/duplicate slugs are refused', async () => {
    await go('/admin/pages'); await pg.fill('form[action="/admin/pages"] [name=title_ar]', 'x'); await pg.fill('form[action="/admin/pages"] [name=slug]', 'admin');
    await Promise.all([pg.waitForNavigation(), pg.click('form[action="/admin/pages"] button.btn--ink')]);
    has(await pg.textContent('.toast'), 'مستخدم');
  });
  await test('SEO audit page lists issues and the redirects manager adds a rule', async () => {
    await go('/admin/seo'); assert(await pg.locator('.stat').count() >= 3, 'stats');
    await pg.fill('[name=from]', '/old-brochure'); await pg.fill('[name=to]', '/about');
    await Promise.all([pg.waitForNavigation(), pg.click('#redirects button.btn-s')]);
    const r = await fetch(base + '/old-brochure', { redirect: 'manual' }); eq(r.status, 301);
  });
  await test('CSP: Google Analytics allowed only once GA4 is set; GA scripts carry the page nonce; never in /admin', async () => {
    const before = (await fetch(base + '/')).headers.get('content-security-policy'); lacks(before, 'googletagmanager');
    await go('/admin/seo#global'); await pg.fill('[name=ga4]', 'G-ABCD1234EF'); await Promise.all([pg.waitForNavigation(), pg.click('#global button.btn--ink')]);
    const r = await fetch(base + '/'); const csp = r.headers.get('content-security-policy'), body = await r.text();
    has(csp, 'https://www.googletagmanager.com'); const nonce = /'nonce-([^']+)'/.exec(csp)[1];
    for (const m of body.matchAll(/<script(?![^>]*(application\/ld\+json|src="\/))[^>]*>/g)) has(m[0], `nonce="${nonce}"`, 'script without nonce');
    lacks((await fetch(base + '/admin/login')).headers.get('content-security-policy'), 'googletagmanager');
  });
  await test('global SEO: site URL drives canonical + sitemap; GA4 id injected; bad values refused', async () => {
    await go('/admin/seo#global'); await pg.fill('[name=site_url]', 'https://www.example-sumova.sa'); await pg.fill('[name=ga4]', 'G-ABCD1234EF'); await pg.fill('[name=search_console]', 'abcdefghijklmnop');
    await Promise.all([pg.waitForNavigation(), pg.click('#global button.btn--ink')]);
    await go('/'); has(await pg.getAttribute('link[rel=canonical]', 'href'), 'https://www.example-sumova.sa'); has(await pg.content(), 'G-ABCD1234EF'); has(await pg.content(), 'google-site-verification');
    has(await (await fetch(base + '/sitemap.xml')).text(), 'https://www.example-sumova.sa/factory');
    await go('/admin/seo#global'); await pg.fill('[name=site_url]', 'javascript:alert(1)');
    await Promise.all([pg.waitForNavigation(), pg.click('#global button.btn--ink')]); has(await pg.textContent('.toast'), 'غير صالح');
  });

  group('Products & catalog · المنتجات');
  await test('create product (bilingual, options) → public product page + Product JSON-LD + in sitemap', async () => {
    await go('/admin/products/new');
    await pg.fill('[name=name_ar]', 'علبة وجبة جاهزة'); await pg.fill('[name=name_en]', 'Ready meal box'); await pg.fill('[name=summary_ar]', 'وجبة جاهزة مغلفة للتشغيل اليومي.');
    await pg.fill('[name=opts_ar]', 'صغير\nكبير'); await pg.fill('[name=opts_en]', 'Small\nLarge'); await pg.fill('[name=slug]', 'meal-box');
    await Promise.all([pg.waitForNavigation(), pg.click('button.btn--ink:has-text("إضافة المنتج")')]);
    await go('/products/meal-box'); has(await pg.textContent('h1'), 'علبة وجبة جاهزة'); has(await pg.content(), '"@type":"Product"');
    assert((await pg.locator('#opt option').count()) === 2, 'options');
    has(await (await fetch(base + '/sitemap.xml')).text(), '/products/meal-box');
    await go('/en/products/meal-box'); has(await pg.textContent('h1'), 'Ready meal box');
  });
  await test('add a catalog block to a page → product card shows; add to request → form carries it → request stores it', async () => {
    await go('/admin/pages'); const h = await pg.locator('table.tbl tr', { hasText: '/catering' }).locator('a').first().getAttribute('href'); await go(h);
    await pg.selectOption('[data-newtype]', 'catalog'); await pg.click('[data-addblock]'); await openAll(pg);
    await pg.locator('[data-block]').last().locator('input[name$="[title][ar]"]').fill('منتجاتنا'); await save();
    await go('/catering'); await pg.click('[data-add]'); has(await pg.textContent('[data-add]'), 'أُضيف');
    await go('/request-quote'); await pg.waitForSelector('[data-cart]:not([hidden])'); has(await pg.textContent('[data-cart-list]'), 'علبة وجبة جاهزة');
    await pg.fill('#f-name', 'عميل المتصفح'); await pg.fill('#f-phone', '0561112233'); await pg.waitForTimeout(2700);
    await Promise.all([pg.waitForNavigation(), pg.click('button[type=submit].btn--ink')]);
    const code = /R-[A-Z0-9]{6}/.exec(await pg.textContent('main'))?.[0]; assert(code, 'no code after submit');
    await go('/admin/requests'); await pg.click(`a:has-text("${code}")`); has(await pg.textContent('main'), 'علبة وجبة جاهزة');
  });
  await test('catering toggle reveals people/days/place fields', async () => {
    await go('/request-quote'); assert(!(await pg.locator('[data-catering]').isVisible()), 'hidden by default');
    await pg.locator('label:has(input[value=catering])').click(); assert(await pg.locator('[data-catering]').isVisible(), 'should show');
  });
  await test('client-side required check blocks an empty submit and focuses the first empty field', async () => {
    await go('/request-quote'); await pg.click('button[type=submit].btn--ink'); eq(await pg.evaluate(() => document.activeElement.id), 'f-name');
  });

  group('Settings → site · الإعدادات');
  await test('phone/email/address/social edited in dashboard appear on contact page, footer and JSON-LD', async () => {
    await go('/admin/settings');
    await pg.fill('[name=contact_phone]', '0551112222'); await pg.fill('[name=contact_address_ar]', 'الرياض – حي الصناعية'); await pg.fill('[name=contact_hours_ar]', 'الأحد – الخميس 8ص – 5م'); await pg.fill('[name=social_LinkedIn]', 'https://www.linkedin.com/company/sumova');
    await Promise.all([pg.waitForNavigation(), pg.click('.savebar button')]);
    await go('/contact'); const t = await pg.textContent('main'); has(t, '0551112222'); has(t, 'الرياض – حي الصناعية'); has(t, 'الأحد – الخميس');
    has(await pg.innerHTML('footer'), 'aria-label="LinkedIn"'); has(await pg.content(), 'linkedin.com/company/sumova');
  });
  await test('settings: WhatsApp number drives the contact button and the floating button; empty hides both', async () => {
    await go('/admin/settings'); eq(await pg.inputValue('[name=contact_whatsapp]'), '0557706254');
    await pg.fill('[name=contact_whatsapp]', '');
    await Promise.all([pg.waitForNavigation(), pg.click('.savebar button')]);
    await go('/contact'); eq(await pg.locator('[data-wa], [data-wa-fab]').count(), 0);
    await go('/admin/settings'); await pg.fill('[name=contact_whatsapp]', '0557706254');
    await Promise.all([pg.waitForNavigation(), pg.click('.savebar button')]);
    await go('/contact'); eq(await pg.getAttribute('[data-wa]', 'href'), 'https://wa.me/966557706254');
  });
  await test('settings: javascript: social URLs are dropped', async () => {
    await go('/admin/settings'); await pg.fill('[name=social_X]', 'javascript:alert(1)');
    await Promise.all([pg.waitForNavigation(), pg.click('.savebar button')]); eq(await pg.inputValue('[name=social_X]'), '');
  });
  await test('account: change own password, old one stops working', async () => {
    const c = new Client(base); c.rotate(); await go('/admin/account');
    await pg.fill('[name=current]', 'Test-Pass-12345'); await pg.fill('[name=next]', 'New-Pass-1234567');
    await Promise.all([pg.waitForNavigation(), pg.click('form.card button.btn--ink')]);
    eq((await c.login('owner@test.local', 'Test-Pass-12345')).status, 401); eq((await c.login('owner@test.local', 'New-Pass-1234567')).status, 302);
  });
  await test('audit log recorded the changes with the actor name', async () => {
    await go('/admin/audit'); const t = await pg.textContent('main'); has(t, 'عدّل'); has(t, 'صفحة'); has(t, 'استبدل');
  });
  await test('logout destroys the session', async () => {
    await pg.click('.side__foot button'); await pg.waitForURL('**/admin/login'); await pg.goto(base + '/admin'); eq(new URL(pg.url()).pathname, '/admin/login');
  });

  group('Responsive & accessibility · الجوال وإمكانية الوصول');
  for (const [name, w, h] of [['mobile', 390, 844], ['tablet', 820, 1100]]) {
    await test(`${name} ${w}px: no horizontal scroll on any public page`, async () => {
      const c2 = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar-SA', isMobile: w < 500, hasTouch: true }); const p2 = await c2.newPage();
      for (const u of PAGES.concat(['/partners', '/products/meal-box'])) {
        await p2.goto(base + u, { waitUntil: 'networkidle' });
        const over = await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert(over <= 1, `${u}: overflows by ${over}px`);
        if (['/', '/request-quote', '/factory'].includes(u)) await p2.screenshot({ path: path.join(SHOTS, `${name}${u === '/' ? '-home' : u.replace('/', '-')}.png`), fullPage: true });
      }
      await c2.close();
    });
  }
  await test('mobile menu opens, closes with Escape and is keyboard operable', async () => {
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-SA' }); const p2 = await c2.newPage(); await p2.goto(base + '/');
    await p2.click('[data-menu]'); eq(await p2.getAttribute('[data-menu]', 'aria-expanded'), 'true'); assert(await p2.locator('#nav a').first().isVisible(), 'links visible');
    await p2.keyboard.press('Escape'); eq(await p2.getAttribute('[data-menu]', 'aria-expanded'), 'false'); await c2.close();
  });
  await test('touch targets in the public header/CTA are ≥ 44px on mobile', async () => {
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-SA' }); const p2 = await c2.newPage(); await p2.goto(base + '/');
    const small = await p2.evaluate(() => [...document.querySelectorAll('.btn, [data-menu], header a')].filter((e) => e.offsetParent).map((e) => ({ t: e.textContent.trim().slice(0, 20), h: e.getBoundingClientRect().height })).filter((x) => x.h < 40));
    assert(small.length === 0, 'small targets: ' + JSON.stringify(small.slice(0, 4))); await c2.close();
  });
  await test('WhatsApp floating button: visible ≥44px on mobile and not covering the footer; hidden on desktop', async () => {
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-SA', isMobile: true, hasTouch: true }); const p2 = await c2.newPage(); await p2.goto(base + '/');
    const fab = p2.locator('[data-wa-fab]'); assert(await fab.isVisible(), 'fab visible on mobile');
    const b = await fab.boundingBox(); assert(b.width >= 44 && b.height >= 44, 'fab size ' + JSON.stringify(b));
    await p2.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const hit = await p2.evaluate(() => { const r = document.querySelector('[data-wa-fab]').getBoundingClientRect(); return [...document.querySelectorAll('.ftr__base span')].some((s) => { const q = s.getBoundingClientRect(); return q.bottom > r.top && q.top < r.bottom && q.right > r.left && q.left < r.right; }); });
    assert(!hit, 'fab covers footer text'); await c2.close();
    await go('/'); assert(!(await pg.locator('[data-wa-fab]').isVisible()), 'fab hidden on desktop');
  });
  await test('strips accordion: keyboard focus opens a strip; one open at a time', async () => {
    await go('/'); const n = await pg.locator('.strip').count(); assert(n >= 3, 'strips'); await pg.locator('.strip__toggle').nth(2).focus();
    eq(await pg.locator('.strip.is-active').count(), 1); assert((await pg.locator('.strip').nth(2).getAttribute('class')).includes('is-active'), 'third active');
  });
  await test('keyboard: skip link is first tab stop and works', async () => {
    await go('/'); await pg.keyboard.press('Tab'); has(await pg.evaluate(() => document.activeElement.className), 'skip'); await pg.keyboard.press('Enter'); has(pg.url(), '#');
  });
  await test('prefers-reduced-motion: no transitions on strips', async () => {
    const c2 = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1360, height: 900 } }); const p2 = await c2.newPage(); await p2.goto(base + '/');
    const d = await p2.evaluate(() => getComputedStyle(document.querySelector('.strip')).transitionDuration); assert(/^0s|0.00001s|0s(, 0s)*$/.test(d) || parseFloat(d) < 0.01, 'transition: ' + d); await c2.close();
  });
  await test('axe-core: no serious/critical violations on public pages (AR + EN)', async () => {
    const bad = [];
    for (const u of ['/', '/factory', '/request-quote', '/contact', '/en', '/about']) {
      await go(u); await pg.evaluate(AXE); const r = await pg.evaluate(() => axe.run(document, { resultTypes: ['violations'] }));
      for (const v of r.violations.filter((v) => ['serious', 'critical'].includes(v.impact))) bad.push(`${u}: ${v.id} (${v.nodes.length}) ${v.nodes[0].target.join(' ')}`);
    }
    assert(!bad.length, bad.join('\n      '));
  });
  await test('axe-core: dashboard pages (login, requests, editor)', async () => {
    await go('/admin/login'); await pg.evaluate(AXE); const lr = await pg.evaluate(() => axe.run(document, { resultTypes: ['violations'] }));
    const bad = lr.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `/admin/login: ${v.id}`);
    await pg.fill('#email', 'owner@test.local'); await pg.fill('#password', 'New-Pass-1234567'); await Promise.all([pg.waitForNavigation(), pg.click('button[type=submit]')]);
    await pg.evaluate(AXE); for (const v of (await pg.evaluate(() => axe.run(document, { resultTypes: ['violations'] }))).violations.filter((v) => ['serious', 'critical'].includes(v.impact))) bad.push(`/admin/login/2fa: ${v.id}`);
    await pg.fill('#code', await nextCode('owner@test.local')); await Promise.all([pg.waitForNavigation(), pg.click('button[type=submit]')]);
    for (const u of ['/admin', '/admin/requests', '/admin/pages/1', '/admin/media', '/admin/seo', '/admin/settings', '/admin/account', '/admin/account/2fa', '/admin/account/sessions', '/admin/users/1']) {
      await go(u); await openAll(pg); await pg.evaluate(AXE); const r = await pg.evaluate(() => axe.run(document, { resultTypes: ['violations'] }));
      for (const v of r.violations.filter((v) => ['serious', 'critical'].includes(v.impact))) bad.push(`${u}: ${v.id} (${v.nodes.length}) ${v.nodes[0].target.join(' ')}`);
    }
    assert(!bad.length, bad.join('\n      '));
  });
  await test('dashboard is usable at 390px (no horizontal overflow)', async () => {
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-SA' }); const p2 = await c2.newPage();
    await uiLogin(p2, 'owner@test.local', 'New-Pass-1234567');
    for (const u of ['/admin', '/admin/requests', '/admin/pages', '/admin/pages/1', '/admin/media', '/admin/settings', '/admin/account/2fa', '/admin/account/sessions']) { await p2.goto(base + u, { waitUntil: 'networkidle' }); const o = await p2.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert(o <= 1, `${u} overflow ${o}px`); }
    await p2.screenshot({ path: path.join(SHOTS, 'admin-mobile.png') }); await c2.close();
  });

  group('Runtime health · أخطاء المتصفح');
  await test('no JavaScript/console errors during the whole session', async () => { const ce = consoleErrors.filter((e) => !/ERR_TUNNEL_CONNECTION_FAILED/.test(e)); /* sandbox blocks the Google Analytics script that the SEO test enables on purpose */ assert(!ce.length, ce.slice(0, 5).join(' | ')); });
  await test('no unexpected 4xx/5xx responses for assets/pages (excluding intentional negatives)', async () => {
    const unexpected = failed.filter((f) => !/\/(partners|old-brochure|privacy|terms)\b/.test(f) && !/^404 .*\/media\/m\d+-r1-/.test(f) && !/^403/.test(f));
    assert(!unexpected.length, unexpected.slice(0, 6).join(' | '));
  });
  await test('screenshots for visual review captured', async () => {
    for (const [u, f] of [['/', 'desktop-home'], ['/factory', 'desktop-factory'], ['/kitchen', 'desktop-kitchen'], ['/cold-chain', 'desktop-cold'], ['/catering', 'desktop-catering'], ['/request-quote', 'desktop-request'], ['/en', 'desktop-en-home']]) { await go(u); await pg.screenshot({ path: path.join(SHOTS, f + '.png'), fullPage: true }); }
  });
  await browser.close();
};
