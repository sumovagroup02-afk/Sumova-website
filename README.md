# موقع سوموفا (SUMOVA) + لوحة التحكم

موقع تعريفي وطلب عروض أسعار، مع لوحة تحكم كاملة (محتوى، صور، منتجات، SEO، طلبات، مستخدمون، API).

## التشغيل

```bash
npm ci
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='كلمة-مرور-قوية-12+' npm start   # http://localhost:3000
npm test            # اختبارات شاملة (HTTP + متصفح)  — تحتاج Playwright/Chromium
```

أول تشغيل ينشئ قاعدة البيانات والصفحات الأساسية والمستخدم المالك. إن لم تحدد `ADMIN_PASSWORD` تُكتب كلمة مرور عشوائية في `data/FIRST-LOGIN.txt` (احذف الملف بعد الدخول).
لوحة التحكم: `/admin`.

## المتغيرات

| المتغير | الوظيفة |
|---|---|
| `PORT` | المنفذ (3000) |
| `DATA_DIR` | مجلد البيانات: قاعدة SQLite والصور المرفوعة وملفات العملاء وعروض الأسعار. **احفظ نسخة احتياطية منه** |
| `SITE_URL` | رابط الموقع النهائي (أو من لوحة التحكم ← تحسين محركات البحث) |
| `COOKIE_SECURE=1` | فعّله خلف HTTPS (يضيف Secure وHSTS) |
| `TRUST_PROXY=1` | فعّله خلف Nginx/Cloudflare ليُقرأ IP الزائر الحقيقي (للحد من الإساءة) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | المالك الأول |
| `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | التخزين الدائم على Cloudflare R2 (قاعدة البيانات عبر Litestream + الملفات + النسخ اليومية) |
| `RESTORE_BACKUP` | تاريخ نسخة تُستعاد مرة واحدة عند التشغيل (مثل `2026-10-25`) |

## النشر
- الاستضافة المعتمدة: **Cloudflare Containers** خلف Worker، والبيانات محفوظة في R2. الخطوات كاملة (الحساب، الأسرار، سجلات DNS، البريد، المراقبة، الاستعادة) في **[DEPLOY.md](DEPLOY.md)**.
- النشر تلقائي من Cloudflare Workers Builds عند كل دفع إلى `main` (`npx wrangler deploy` من جذر المستودع، الإعداد في `wrangler.jsonc`). الاختبارات تعمل في GitHub Actions (`.github/workflows/deploy.yml`).
- Docker محليًا: `docker build -t sumova . && docker run -d -p 3000:3000 -v sumova-data:/data -e ADMIN_PASSWORD=… sumova` (بدون `R2_*` يعمل كما هو على القرص).
- النسخ الاحتياطي: `node ops/data.mjs backup | list | restore <date|latest> <dir>` (انظر DEPLOY.md).

## الربط (n8n وغيره)
- الإعدادات ← رابط Webhook: يصل حدث JSON موقّع (`x-sumova-signature` = HMAC-SHA256 للجسم) عند: `request.created` · `request.quoted` · `request.decision` · `request.status`.
- مفاتيح API من لوحة التحكم ← الربط: `GET /api/v1/requests`, `GET /api/v1/requests/:code`, `PATCH /api/v1/requests/:code` (`Authorization: Bearer smv_…`).

## الهيكل
`src/blocks.js` يعرّف أقسام الصفحات (لوحة التحكم تبني نماذجها منه)، و`src/site/render.js` يعرضها. إضافة نوع قسم جديد = تعريفه في `blocks.js` + دالة عرض واحدة.
